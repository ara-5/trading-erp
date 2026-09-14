import { Role } from '@prisma/client';
import { CopilotTools } from './copilot.tools';

const makeTools = () => new CopilotTools({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

describe('CopilotTools', () => {
  const tools = makeTools();

  it('gives ADMIN every tool, including role-gated ones', () => {
    const names = tools.forRole(Role.ADMIN).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['trial_balance_summary', 'pending_leave_requests', 'low_stock_items', 'list_overdue_sales_invoices']),
    );
  });

  it('keeps role-gated tools away from unrelated roles', () => {
    const salesNames = tools.forRole(Role.SALES).map((t) => t.name);
    expect(salesNames).toContain('list_overdue_sales_invoices');
    expect(salesNames).not.toContain('pending_leave_requests');
    expect(salesNames).not.toContain('trial_balance_summary');
    expect(salesNames).not.toContain('list_overdue_purchase_bills');
  });

  it('gives every authenticated role the ungated tools', () => {
    for (const role of [Role.SALES, Role.HR, Role.VIEWER, Role.INVENTORY, Role.PURCHASING]) {
      const names = tools.forRole(role).map((t) => t.name);
      expect(names).toContain('dashboard_summary');
      expect(names).toContain('search_products');
    }
  });

  it('never exposes a tool that can write data — every tool name reads as a query', () => {
    const names = tools.forRole(Role.ADMIN).map((t) => t.name);
    expect(names.every((n) => !/^(create|update|delete|post|pay|void|approve|reject|adjust|transfer)/i.test(n))).toBe(true);
  });

  it('produces Anthropic-shaped tool schemas for every role', () => {
    for (const role of Object.values(Role)) {
      const anthropicTools = tools.toAnthropicTools(role);
      expect(anthropicTools.length).toBeGreaterThan(0);
      for (const t of anthropicTools) {
        expect(t.name).toEqual(expect.any(String));
        expect(t.description?.length ?? 0).toBeGreaterThan(10);
        expect(t.input_schema).toMatchObject({ type: 'object' });
      }
    }
  });
});
