import Anthropic from '@anthropic-ai/sdk';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../common/auth';
import { AuditService } from '../common/common.module';
import { CopilotBudget } from './copilot.budget';
import { CopilotTools } from './copilot.tools';

export const COPILOT_MODEL = () => process.env.COPILOT_MODEL || 'claude-opus-5';
export const copilotConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export type ChatEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'tool'; data: { name: string; input: unknown } }
  | { event: 'tool_result'; data: { name: string; ok: boolean } }
  | { event: 'done'; data: Record<string, never> }
  | { event: 'error'; data: { message: string } };

const chatMessageSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(4000) });
export const chatSchema = z.object({ messages: z.array(chatMessageSchema).min(1).max(40) });
export type ChatDto = z.infer<typeof chatSchema>;

const billLineSchema = z.object({
  description: z.string(),
  quantity: z.number().finite(),
  unitPrice: z.number().finite(),
  taxRatePct: z.coerce.number().finite().default(0),
});
export const extractedBillSchema = z.object({
  supplierName: z.string().nullable(),
  supplierTaxNumber: z.string().nullable(),
  reference: z.string().nullable(),
  date: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(billLineSchema).default([]),
  subtotal: z.number().nullable(),
  taxTotal: z.number().nullable(),
  total: z.number().nullable(),
});
export type ExtractedBill = z.infer<typeof extractedBillSchema>;

export const extractBillSchema = z.object({
  fileBase64: z.string().min(1),
  mediaType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
});
export type ExtractBillDto = z.infer<typeof extractBillSchema>;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_ITERATIONS = 6;
const EXTRACTION_PROMPT = `Extract this supplier bill/invoice into JSON with EXACTLY this shape and nothing else — no markdown fences, no commentary, just the JSON object:
{"supplierName": string|null, "supplierTaxNumber": string|null, "reference": string|null, "date": "YYYY-MM-DD"|null, "dueDate": "YYYY-MM-DD"|null, "currency": string|null,
 "lines": [{"description": string, "quantity": number, "unitPrice": number, "taxRatePct": number}],
 "subtotal": number|null, "taxTotal": number|null, "total": number|null}
Use null for any field you cannot read with confidence — never guess. Quantities, prices and rates are numbers, not strings. "reference" is the supplier's own invoice/bill number, if shown.`;

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly tools: CopilotTools,
    private readonly budget: CopilotBudget,
    private readonly audit: AuditService,
  ) {}

  private client() {
    if (!copilotConfigured()) throw new ServiceUnavailableException('The AI copilot is not configured on this server (missing ANTHROPIC_API_KEY).');
    return new Anthropic();
  }

  async chat(user: AuthUser, history: ChatDto['messages'], emit: (e: ChatEvent) => void) {
    let client: Anthropic;
    try {
      this.budget.consume();
      client = this.client();
    } catch (e) {
      emit({ event: 'error', data: { message: e instanceof Error ? e.message : 'The AI copilot is unavailable.' } });
      return;
    }

    const toolDefs = this.tools.forRole(user.role);
    const tools = this.tools.toAnthropicTools(user.role);
    const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    const system =
      `You are the ERP Copilot, a read-only assistant embedded in an ERP system, talking to ${user.name} (role: ${user.role}). ` +
      'Answer using the tools provided — never invent figures, and never claim to have taken an action, since you cannot create, edit, post, pay or delete anything. ' +
      'Keep answers brief (a few sentences, or a short list) and mention specific document or account numbers when they matter. ' +
      `Today's date is ${new Date().toISOString().slice(0, 10)}. If no tool can answer the question, say so plainly rather than guessing.`;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let final: Anthropic.Message;
      try {
        const stream = client.messages.stream({
          model: COPILOT_MODEL(),
          max_tokens: 1024,
          system,
          tools: tools.length ? tools : undefined,
          messages,
        });
        stream.on('text', (text) => emit({ event: 'token', data: { text } }));
        final = await stream.finalMessage();
      } catch (e) {
        this.logger.warn(`Copilot chat failed: ${e instanceof Error ? e.message : e}`);
        emit({ event: 'error', data: { message: e instanceof Anthropic.APIError ? e.message : 'The AI copilot had a problem answering that.' } });
        return;
      }

      messages.push({ role: 'assistant', content: final.content });
      if (final.stop_reason !== 'tool_use') {
        emit({ event: 'done', data: {} });
        return;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        emit({ event: 'tool', data: { name: block.name, input: block.input } });
        const tool = toolDefs.find((t) => t.name === block.name);
        if (!tool) {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: 'This tool is not available for your role.', is_error: true });
          emit({ event: 'tool_result', data: { name: block.name, ok: false } });
          continue;
        }
        const parsed = tool.schema.safeParse(block.input ?? {});
        if (!parsed.success) {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Invalid input: ${parsed.error.message}`, is_error: true });
          emit({ event: 'tool_result', data: { name: block.name, ok: false } });
          continue;
        }
        try {
          const result = await tool.run(parsed.data);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          emit({ event: 'tool_result', data: { name: block.name, ok: true } });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: e instanceof Error ? e.message : 'Tool failed', is_error: true });
          emit({ event: 'tool_result', data: { name: block.name, ok: false } });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    emit({ event: 'error', data: { message: 'Reached the limit of tool calls for one question — try breaking it into smaller questions.' } });
  }

  async extractBill(user: AuthUser, dto: ExtractBillDto): Promise<ExtractedBill> {
    this.budget.consume();
    const client = this.client();
    const approxBytes = (dto.fileBase64.length * 3) / 4;
    if (approxBytes > MAX_FILE_BYTES) throw new BadRequestException('File is too large (max 8MB)');

    const documentBlock: Anthropic.Base64PDFSource | Anthropic.Base64ImageSource =
      dto.mediaType === 'application/pdf'
        ? { type: 'base64', media_type: 'application/pdf', data: dto.fileBase64 }
        : { type: 'base64', media_type: dto.mediaType, data: dto.fileBase64 };

    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: COPILOT_MODEL(),
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              dto.mediaType === 'application/pdf'
                ? { type: 'document', source: documentBlock as Anthropic.Base64PDFSource }
                : { type: 'image', source: documentBlock as Anthropic.Base64ImageSource },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          },
        ],
      });
    } catch (e) {
      this.logger.warn(`Copilot extraction failed: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException(e instanceof Anthropic.APIError ? e.message : 'Could not read that document.');
    }

    const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
    const data = parseExtractedBillText(text);
    await this.audit.log(user.sub, 'extract', 'PurchaseBill', undefined, { supplierName: data.supplierName, lines: data.lines.length });
    return data;
  }
}

/**
 * Parses the model's JSON-only reply into an `ExtractedBill`, tolerating a stray markdown fence or
 * leading/trailing prose by slicing between the first `{` and the last `}`. Pulled out as a standalone
 * function so the parsing logic itself is unit-testable without an API call.
 */
export function parseExtractedBillText(text: string): ExtractedBill {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new BadRequestException('Could not read that document as a bill — try a clearer scan or enter it manually.');
  }
  const parsed = extractedBillSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Could not make sense of that document — try a clearer scan or enter it manually.');
  return parsed.data;
}
