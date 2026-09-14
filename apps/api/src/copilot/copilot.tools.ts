import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z, ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ReportsService } from '../accounting/reports';
import { D } from '../common/money';
import { DashboardService } from '../dashboard/dashboard.module';
import { HrService } from '../hr/hr.module';
import { InventoryService } from '../inventory/inventory.module';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.module';

/**
 * A read-only capability the copilot can call. `roles` restricts it the same way `@Roles()` restricts a
 * route. `T` defaults to `any` (not `unknown`) so each tool literal below can declare its own concrete
 * input type without fighting TypeScript's contravariant checking of function-typed properties.
 */
export interface CopilotTool<T = any> {
  name: string;
  description: string;
  // Plain ZodTypeAny (not ZodType<T>): keeps this field's type erased so an array of tools with
  // different, concrete `T`s doesn't force TypeScript into resolving a deep union when it's later
  // passed to zodToJsonSchema — that combination blows the compiler's instantiation-depth limit.
  schema: ZodTypeAny;
  roles?: Role[];
  run: (input: T) => Promise<unknown>;
}

const limitField = z.coerce.number().int().min(1).max(50);
const dateField = z.coerce.date();
const nameField = z.string().trim().min(1).max(200);
const overdueBucket = (dueDate: Date) => Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86_400_000));

/**
 * The tool registry backing the AI copilot. Every tool is read-only — none of them can create, change, or
 * delete a record — so the copilot can never post a journal entry, issue a payment, or edit stock on the
 * user's behalf. `forRole` mirrors the same allow-list the REST routes use, so the model only ever sees
 * (and can only ever call) what that user's role could see through the normal UI.
 */
@Injectable()
export class CopilotTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly dashboard: DashboardService,
    private readonly sales: SalesService,
    private readonly hr: HrService,
    private readonly inventory: InventoryService,
  ) {}

  private list(): CopilotTool[] {
    return [
      {
        name: 'dashboard_summary',
        description:
          "The headline KPIs: this month's sales, cash on hand, total receivables and payables, low-stock item count, open sales/purchase orders, headcount and pending leave.",
        schema: z.object({}),
        run: () => this.dashboard.summary(),
      },
      {
        name: 'list_overdue_sales_invoices',
        description: 'Customer invoices that are posted or partially paid and past their due date, most overdue first.',
        schema: z.object({ limit: limitField.optional() }),
        roles: [Role.SALES, Role.ACCOUNTANT],
        run: async ({ limit }: { limit?: number }) => {
          const rows = await this.prisma.salesInvoice.findMany({
            where: { status: { in: ['POSTED', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
            include: { customer: { select: { name: true } } },
            orderBy: { dueDate: 'asc' },
            take: limit ?? 10,
          });
          return rows.map((r) => ({
            number: r.number,
            customer: r.customer.name,
            dueDate: r.dueDate.toISOString().slice(0, 10),
            daysOverdue: overdueBucket(r.dueDate),
            outstanding: D(r.total).minus(r.amountPaid).toFixed(2),
          }));
        },
      },
      {
        name: 'list_overdue_purchase_bills',
        description: 'Supplier bills that are posted or partially paid and past their due date, most overdue first.',
        schema: z.object({ limit: limitField.optional() }),
        roles: [Role.PURCHASING, Role.ACCOUNTANT],
        run: async ({ limit }: { limit?: number }) => {
          const rows = await this.prisma.purchaseBill.findMany({
            where: { status: { in: ['POSTED', 'PARTIALLY_PAID'] }, dueDate: { lt: new Date() } },
            include: { supplier: { select: { name: true } } },
            orderBy: { dueDate: 'asc' },
            take: limit ?? 10,
          });
          return rows.map((r) => ({
            number: r.number,
            supplier: r.supplier.name,
            dueDate: r.dueDate.toISOString().slice(0, 10),
            daysOverdue: overdueBucket(r.dueDate),
            outstanding: D(r.total).minus(r.amountPaid).toFixed(2),
          }));
        },
      },
      {
        name: 'customer_balance',
        description: 'Looks up a customer by name and returns their outstanding (unpaid) balance across open invoices.',
        schema: z.object({ name: nameField }),
        roles: [Role.SALES, Role.ACCOUNTANT],
        run: async ({ name }: { name: string }) => {
          const customer = await this.prisma.customer.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } });
          if (!customer) return { found: false };
          const outstanding = await this.sales.outstanding(this.prisma, customer.id);
          return { found: true, name: customer.name, code: customer.code, creditLimit: customer.creditLimit, outstanding: outstanding.toFixed(2) };
        },
      },
      {
        name: 'supplier_balance',
        description: 'Looks up a supplier by name and returns how much they are owed across open bills.',
        schema: z.object({ name: nameField }),
        roles: [Role.PURCHASING, Role.ACCOUNTANT],
        run: async ({ name }: { name: string }) => {
          const supplier = await this.prisma.supplier.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } });
          if (!supplier) return { found: false };
          const agg = await this.prisma.purchaseBill.aggregate({
            where: { supplierId: supplier.id, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
            _sum: { total: true, amountPaid: true },
          });
          return { found: true, name: supplier.name, code: supplier.code, owed: D(agg._sum.total).minus(D(agg._sum.amountPaid)).toFixed(2) };
        },
      },
      {
        name: 'search_products',
        description: 'Searches products by name or SKU and returns stock on hand, average cost and sale price.',
        schema: z.object({ query: z.string().trim().min(1).max(100) }),
        run: async ({ query }: { query: string }) => {
          const products = await this.prisma.product.findMany({
            where: { isActive: true, OR: [{ name: { contains: query, mode: 'insensitive' } }, { sku: { contains: query, mode: 'insensitive' } }] },
            take: 8,
          });
          return Promise.all(
            products.map(async (p) => {
              const agg = await this.prisma.stockLevel.aggregate({ where: { productId: p.id }, _sum: { quantity: true } });
              return { sku: p.sku, name: p.name, onHand: p.trackInventory ? D(agg._sum.quantity).toString() : 'not tracked', costPrice: p.costPrice, salePrice: p.salePrice };
            }),
          );
        },
      },
      {
        name: 'low_stock_items',
        description: 'Products at or below their reorder level right now.',
        schema: z.object({}),
        roles: [Role.INVENTORY, Role.PURCHASING],
        run: () => this.inventory.lowStock(),
      },
      {
        name: 'trial_balance_summary',
        description: 'Trial balance totals as of a date, plus the largest account balances.',
        schema: z.object({ asOf: dateField.optional() }),
        roles: [Role.ACCOUNTANT],
        run: async ({ asOf }: { asOf?: Date }) => {
          const tb = await this.reports.trialBalance(asOf);
          const top = [...tb.rows].sort((a, b) => Number(D(b.debit).minus(b.credit).abs()) - Number(D(a.debit).minus(a.credit).abs())).slice(0, 8);
          return { asOf: tb.asOf.toISOString().slice(0, 10), totalDebit: tb.totalDebit.toFixed(2), totalCredit: tb.totalCredit.toFixed(2), topAccounts: top };
        },
      },
      {
        name: 'profit_and_loss_summary',
        description: 'Total income, total expenses and net profit for a date range, defaulting to year-to-date.',
        schema: z.object({ from: dateField.optional(), to: dateField.optional() }),
        roles: [Role.ACCOUNTANT],
        run: async ({ from, to }: { from?: Date; to?: Date }) => {
          const now = new Date();
          const pl = await this.reports.profitLoss(from ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to ?? now);
          return {
            from: pl.from.toISOString().slice(0, 10),
            to: pl.to.toISOString().slice(0, 10),
            totalIncome: pl.totalIncome.toFixed(2),
            totalExpenses: pl.totalExpenses.toFixed(2),
            netProfit: pl.netProfit.toFixed(2),
            topIncome: pl.income.slice(0, 5).map((r) => ({ name: r.name, amount: r.balance.toFixed(2) })),
            topExpenses: pl.expenses.slice(0, 5).map((r) => ({ name: r.name, amount: r.balance.toFixed(2) })),
          };
        },
      },
      {
        name: 'pending_leave_requests',
        description: 'Leave requests awaiting a decision.',
        schema: z.object({ limit: limitField.optional() }),
        roles: [Role.HR],
        run: ({ limit }: { limit?: number }) =>
          this.prisma.leaveRequest.findMany({
            where: { status: 'PENDING' },
            include: { employee: { select: { firstName: true, lastName: true } }, leaveType: { select: { name: true } } },
            orderBy: { startDate: 'asc' },
            take: limit ?? 10,
          }),
      },
      {
        name: 'employee_leave_balance',
        description: 'Looks up an employee by name and returns their leave balance for the current year.',
        schema: z.object({ name: nameField }),
        roles: [Role.HR],
        run: async ({ name }: { name: string }) => {
          const [first, ...rest] = name.trim().split(/\s+/);
          const employee = await this.prisma.employee.findFirst({
            where: { OR: [{ firstName: { contains: first, mode: 'insensitive' } }, { lastName: { contains: rest.join(' ') || first, mode: 'insensitive' } }] },
          });
          if (!employee) return { found: false };
          const balances = await this.hr.leaveBalances(this.prisma, employee.id, new Date());
          return { found: true, name: `${employee.firstName} ${employee.lastName}`, status: employee.status, balances };
        },
      },
    ];
  }

  forRole(role: Role): CopilotTool[] {
    return this.list().filter((t) => !t.roles || role === Role.ADMIN || t.roles.includes(role));
  }

  toAnthropicTools(role: Role): Anthropic.Tool[] {
    return this.forRole(role).map((t) => ({
      name: t.name,
      description: t.description,
      // Cast the schema to `any` first: with many differently-shaped tool schemas erased to one array,
      // TypeScript's structural inference through zodToJsonSchema's generics exceeds its depth limit.
      input_schema: zodToJsonSchema(t.schema as any, { target: 'openApi3', $refStrategy: 'none' }) as unknown as Anthropic.Tool.InputSchema,
    }));
  }
}
