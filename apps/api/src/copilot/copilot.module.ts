import { Body, Controller, Get, Module, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AccountingModule } from '../accounting/accounting.module';
import { AllowInDemoMode, AuthUser, CurrentUser, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { DashboardModule } from '../dashboard/dashboard.module';
import { HrModule } from '../hr/hr.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { CopilotBudget } from './copilot.budget';
import { ChatDto, chatSchema, copilotConfigured, CopilotService, ExtractBillDto, extractBillSchema } from './copilot.service';
import { CopilotTools } from './copilot.tools';

const rateLimit = (envVar: string, fallback: number) => ({ default: { limit: () => Number(process.env[envVar] ?? fallback), ttl: 60_000 } });

@Controller('copilot')
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly budget: CopilotBudget,
  ) {}

  @Get('status')
  status() {
    return { configured: copilotConfigured(), dailyRemaining: this.budget.remaining };
  }

  @AllowInDemoMode()
  @Throttle(rateLimit('COPILOT_CHAT_RATE_LIMIT', 20))
  @Post('chat')
  async chat(@Body(new ZodPipe(chatSchema)) body: ChatDto, @CurrentUser() user: AuthUser, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const emit = (e: { event: string; data: unknown }) => res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    try {
      await this.copilot.chat(user, body.messages, emit);
    } catch {
      emit({ event: 'error', data: { message: 'The AI copilot had an unexpected problem.' } });
    } finally {
      res.end();
    }
  }

  @Roles(Role.PURCHASING, Role.ACCOUNTANT)
  @AllowInDemoMode()
  @Throttle(rateLimit('COPILOT_EXTRACT_RATE_LIMIT', 10))
  @Post('extract-bill')
  extractBill(@Body(new ZodPipe(extractBillSchema)) body: ExtractBillDto, @CurrentUser() user: AuthUser) {
    return this.copilot.extractBill(user, body);
  }
}

@Module({
  imports: [AccountingModule, InventoryModule, SalesModule, HrModule, DashboardModule],
  controllers: [CopilotController],
  providers: [CopilotTools, CopilotBudget, CopilotService],
})
export class CopilotModule {}
