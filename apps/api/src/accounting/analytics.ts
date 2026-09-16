import { Controller, Get, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/auth';
import { D, Decimal, ZERO } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { naturalBalance } from './ledger.service';
import { ReportsService } from './reports';

const MONTHS_BACK = 12;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  async overview() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK - 1), 1));
    const months = Array.from({ length: MONTHS_BACK }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK - 1) + i, 1));
      return d.toISOString().slice(0, 7);
    });

    const [incomeExpenseRows, cashRows, topCustomerRows, agingReceivables, agingPayables] = await Promise.all([
      this.prisma.$queryRaw<{ month: string; type: string; debit: number; credit: number }[]>`
        SELECT to_char(date_trunc('month', je."date"), 'YYYY-MM') AS month, a."type"::text AS type,
               SUM(jl."debit")::float AS debit, SUM(jl."credit")::float AS credit
        FROM "JournalLine" jl
        JOIN "JournalEntry" je ON je.id = jl."entryId"
        JOIN "Account" a ON a.id = jl."accountId"
        WHERE je."status" = 'POSTED' AND je."sourceType" != 'CLOSING' AND a."type" IN ('INCOME', 'EXPENSE') AND je."date" >= ${start}
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ month: string; debit: number; credit: number }[]>`
        SELECT to_char(date_trunc('month', je."date"), 'YYYY-MM') AS month,
               SUM(jl."debit")::float AS debit, SUM(jl."credit")::float AS credit
        FROM "JournalLine" jl
        JOIN "JournalEntry" je ON je.id = jl."entryId"
        JOIN "SystemAccount" sa ON sa."accountId" = jl."accountId" AND sa."key" IN ('CASH', 'BANK')
        WHERE je."status" = 'POSTED' AND je."date" < ${start}
        GROUP BY 1`.then(async (before) => {
        // Opening balance (everything before the window) plus one row per month inside it, so the running total is a true balance, not just in-window movement.
        const opening = before.reduce((s, r) => s + (r.debit ?? 0) - (r.credit ?? 0), 0);
        const inWindow = await this.prisma.$queryRaw<{ month: string; debit: number; credit: number }[]>`
          SELECT to_char(date_trunc('month', je."date"), 'YYYY-MM') AS month,
                 SUM(jl."debit")::float AS debit, SUM(jl."credit")::float AS credit
          FROM "JournalLine" jl
          JOIN "JournalEntry" je ON je.id = jl."entryId"
          JOIN "SystemAccount" sa ON sa."accountId" = jl."accountId" AND sa."key" IN ('CASH', 'BANK')
          WHERE je."status" = 'POSTED' AND je."date" >= ${start}
          GROUP BY 1`;
        return { opening, inWindow };
      }),
      this.prisma.salesInvoiceLine.groupBy({
        by: ['invoiceId'],
        where: { invoice: { status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] }, date: { gte: start } } },
        _sum: { lineTotal: true },
      }),
      this.reports.aging('receivables'),
      this.reports.aging('payables'),
    ]);

    const byMonth = (type: 'INCOME' | 'EXPENSE', month: string) => {
      const r = incomeExpenseRows.find((x) => x.month === month && x.type === type);
      return naturalBalance(type, D(r?.debit ?? 0), D(r?.credit ?? 0));
    };
    const financials = months.map((month) => {
      const income = byMonth('INCOME', month);
      const expense = byMonth('EXPENSE', month);
      return { month, income: income.toNumber(), expense: expense.toNumber(), netProfit: income.minus(expense).toNumber() };
    });

    let running = D(cashRows.opening);
    const cashTrend = months.map((month) => {
      const r = cashRows.inWindow.find((x) => x.month === month);
      running = running.plus(D(r?.debit ?? 0)).minus(D(r?.credit ?? 0));
      return { month, balance: running.toNumber() };
    });

    const invoiceIds = topCustomerRows.map((r) => r.invoiceId);
    const invoices = invoiceIds.length
      ? await this.prisma.salesInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, customerId: true, customer: { select: { name: true } } } })
      : [];
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const revenueByCustomer = new Map<string, { name: string; revenue: Decimal }>();
    for (const row of topCustomerRows) {
      const inv = invoiceById.get(row.invoiceId);
      if (!inv) continue;
      const entry = revenueByCustomer.get(inv.customerId) ?? { name: inv.customer.name, revenue: ZERO };
      entry.revenue = entry.revenue.plus(D(row._sum.lineTotal));
      revenueByCustomer.set(inv.customerId, entry);
    }
    const topCustomers = [...revenueByCustomer.entries()]
      .map(([customerId, v]) => ({ customerId, name: v.name, revenue: v.revenue.toNumber() }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    return {
      financials,
      cashTrend,
      topCustomers,
      aging: {
        receivables: { current: agingReceivables.totals.current, d1_30: agingReceivables.totals.d1_30, d31_60: agingReceivables.totals.d31_60, d61_90: agingReceivables.totals.d61_90, d90plus: agingReceivables.totals.d90plus },
        payables: { current: agingPayables.totals.current, d1_30: agingPayables.totals.d1_30, d31_60: agingPayables.totals.d31_60, d61_90: agingPayables.totals.d61_90, d90plus: agingPayables.totals.d90plus },
      },
    };
  }
}

@Roles(Role.ACCOUNTANT)
@Controller('accounting/analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get()
  overview() {
    return this.svc.overview();
  }
}
