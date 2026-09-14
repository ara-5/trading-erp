import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * A blunt, in-memory cap on how many AI-copilot calls (chat turns + document extractions) the whole server
 * will make in a day. It resets at UTC midnight and is process-local — good enough to stop a public demo
 * from running up an API bill, not a substitute for real per-tenant billing.
 */
@Injectable()
export class CopilotBudget {
  private day = '';
  private count = 0;

  consume(cost = 1) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    const limit = Number(process.env.COPILOT_DAILY_LIMIT ?? 50);
    if (this.count + cost > limit) {
      throw new HttpException('The AI copilot has reached its shared daily usage limit. Please try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.count += cost;
  }

  get remaining() {
    return Math.max(0, Number(process.env.COPILOT_DAILY_LIMIT ?? 50) - (this.day === new Date().toISOString().slice(0, 10) ? this.count : 0));
  }
}
