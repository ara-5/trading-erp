import { CopilotBudget } from './copilot.budget';

describe('CopilotBudget', () => {
  const original = process.env.COPILOT_DAILY_LIMIT;
  afterEach(() => {
    process.env.COPILOT_DAILY_LIMIT = original;
  });

  it('allows calls up to the daily limit, then rejects with 429', () => {
    process.env.COPILOT_DAILY_LIMIT = '3';
    const budget = new CopilotBudget();
    budget.consume();
    budget.consume();
    budget.consume();
    expect(() => budget.consume()).toThrow(/daily usage limit/);
    expect(() => budget.consume()).toThrow(expect.objectContaining({ status: 429 }));
  });

  it('reports how many calls remain today', () => {
    process.env.COPILOT_DAILY_LIMIT = '5';
    const budget = new CopilotBudget();
    expect(budget.remaining).toBe(5);
    budget.consume();
    budget.consume();
    expect(budget.remaining).toBe(3);
  });

  it('accepts a larger cost per call', () => {
    process.env.COPILOT_DAILY_LIMIT = '10';
    const budget = new CopilotBudget();
    budget.consume(4);
    budget.consume(4);
    expect(() => budget.consume(4)).toThrow();
    expect(budget.remaining).toBe(2);
  });
});
