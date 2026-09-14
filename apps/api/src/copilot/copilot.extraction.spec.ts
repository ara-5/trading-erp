import { BadRequestException } from '@nestjs/common';
import { parseExtractedBillText } from './copilot.service';

const validJson = JSON.stringify({
  supplierName: 'Acme Supplies',
  supplierTaxNumber: 'TX-123',
  reference: 'INV-9981',
  date: '2026-03-01',
  dueDate: '2026-03-31',
  currency: 'USD',
  lines: [{ description: 'Widgets', quantity: 10, unitPrice: 5, taxRatePct: 15 }],
  subtotal: 50,
  taxTotal: 7.5,
  total: 57.5,
});

describe('parseExtractedBillText', () => {
  it('parses a clean JSON reply', () => {
    const result = parseExtractedBillText(validJson);
    expect(result.supplierName).toBe('Acme Supplies');
    expect(result.lines).toHaveLength(1);
    expect(result.total).toBe(57.5);
  });

  it('tolerates a markdown code fence and leading prose', () => {
    const result = parseExtractedBillText(`Here you go:\n\`\`\`json\n${validJson}\n\`\`\`\nLet me know if you need anything else.`);
    expect(result.supplierName).toBe('Acme Supplies');
  });

  it('defaults a missing taxRatePct to zero', () => {
    const withoutTax = JSON.stringify({ ...JSON.parse(validJson), lines: [{ description: 'Service', quantity: 1, unitPrice: 100 }] });
    expect(parseExtractedBillText(withoutTax).lines[0].taxRatePct).toBe(0);
  });

  it('rejects text with no JSON object', () => {
    expect(() => parseExtractedBillText('Sorry, I could not read this document.')).toThrow(BadRequestException);
  });

  it('rejects a JSON object that does not match the bill shape', () => {
    // Every top-level field is required (nullable, not optional) — the model must emit the full shape.
    expect(() => parseExtractedBillText('{"unrelated": true}')).toThrow(BadRequestException);
    expect(() => parseExtractedBillText('{"lines": [{"description": "x"}]}')).toThrow(BadRequestException); // missing quantity/unitPrice too
  });
});
