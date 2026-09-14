import { Controller, Get, Injectable, Param, Query } from '@nestjs/common';
import { AccountType, Role } from '@prisma/client';
import { z } from 'zod';
import { Roles } from '../common/auth';
import { daysBetween, endOfDay } from '../common/dates';
import { D, Decimal, ZERO } from '../common/money';
import { zDate, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { naturalBalance } from './ledger.service';

const rangeSchema = z.object({ from: zDate.optional(), to: zDate.optional(), asOf: zDate.optional() });
type Range = z.infer<typeof rangeSchema>;

const sum = (rows: { balance: Decimal }[]) => rows.reduce((s, r) => s.plus(r.balance), ZERO);

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `excludeClosing` hides year-end closing entries, which would otherwise zero out a closed year's P&L. */
  private async balances(from?: Date, to?: Date, excludeClosing = false) {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          entry: { status: 'POSTED', date: { gte: from, lte: to && endOfDay(to) }, ...(excludeClosing && { sourceType: { not: 'CLOSING' as const } }) },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
    return accounts.map((a) => {
      const s = byId.get(a.id);
      const debit = D(s?.debit);
      const credit = D(s?.credit);
      return { id: a.id, code: a.code, name: a.name, type: a.type, debit, credit, balance: naturalBalance(a.type, debit, credit) };
    });
  }

  async trialBalance(asOf = new Date()) {
    const rows = (await this.balances(undefined, asOf))
      .map((r) => {
        const net = r.debit.minus(r.credit);
        return { id: r.id, code: r.code, name: r.name, type: r.type, debit: net.gt(0) ? net : ZERO, credit: net.lt(0) ? net.neg() : ZERO };
      })
      .filter((r) => !r.debit.isZero() || !r.credit.isZero());
    return {
      asOf,
      rows,
      totalDebit: rows.reduce((s, r) => s.plus(r.debit), ZERO),
      totalCredit: rows.reduce((s, r) => s.plus(r.credit), ZERO),
    };
  }

  async profitLoss(from: Date, to: Date) {
    const rows = (await this.balances(from, to, true)).filter((r) => !r.balance.isZero());
    const income = rows.filter((r) => r.type === AccountType.INCOME);
    const expenses = rows.filter((r) => r.type === AccountType.EXPENSE);
    const totalIncome = sum(income);
    const totalExpenses = sum(expenses);
    return { from, to, income, expenses, totalIncome, totalExpenses, netProfit: totalIncome.minus(totalExpenses) };
  }

  async balanceSheet(asOf = new Date()) {
    const rows = (await this.balances(undefined, asOf)).filter((r) => !r.balance.isZero());
    const of = (t: AccountType) => rows.filter((r) => r.type === t);
    const assets = of('ASSET');
    const liabilities = of('LIABILITY');
    const equity = of('EQUITY');
    // Without period-closing entries, cumulative profit is shown as a separate equity line.
    const currentEarnings = sum(of('INCOME')).minus(sum(of('EXPENSE')));
    const totalAssets = sum(assets);
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity).plus(currentEarnings);
    return {
      asOf,
      assets,
      liabilities,
      equity,
      currentEarnings,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: totalAssets.equals(totalLiabilities.plus(totalEquity)),
    };
  }

  async generalLedger(accountId: string, from?: Date, to?: Date) {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    let opening = ZERO;
    if (from) {
      const agg = await this.prisma.journalLine.aggregate({
        where: { accountId, entry: { status: 'POSTED', date: { lt: from } } },
        _sum: { debit: true, credit: true },
      });
      opening = naturalBalance(account.type, D(agg._sum.debit), D(agg._sum.credit));
    }
    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, entry: { status: 'POSTED', date: { gte: from, lte: to && endOfDay(to) } } },
      include: { entry: { select: { id: true, number: true, date: true, description: true, reference: true, sourceType: true } } },
      orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
    });
    let running = opening;
    const rows = lines.map((l) => {
      running = running.plus(naturalBalance(account.type, D(l.debit), D(l.credit)));
      return { ...l.entry, lineDescription: l.description, debit: l.debit, credit: l.credit, balance: running };
    });
    return { account, from, to, opening, rows, closing: running };
  }

  async aging(kind: 'receivables' | 'payables', asOf = new Date()) {
    const open = { status: { in: ['POSTED', 'PARTIALLY_PAID'] as ('POSTED' | 'PARTIALLY_PAID')[] }, date: { lte: endOfDay(asOf) } };
    const docs =
      kind === 'receivables'
        ? (await this.prisma.salesInvoice.findMany({ where: open, include: { customer: { select: { id: true, name: true } } } })).map((d) => ({
            ...d,
            party: d.customer,
          }))
        : (await this.prisma.purchaseBill.findMany({ where: open, include: { supplier: { select: { id: true, name: true } } } })).map((d) => ({
            ...d,
            party: d.supplier,
          }));

    type Bucket = { partyId: string; partyName: string; current: Decimal; d1_30: Decimal; d31_60: Decimal; d61_90: Decimal; d90plus: Decimal; total: Decimal };
    const byParty = new Map<string, Bucket>();
    for (const d of docs) {
      const outstanding = D(d.total).minus(d.amountPaid);
      if (outstanding.lte(0)) continue;
      const b = byParty.get(d.party.id) ?? {
        partyId: d.party.id,
        partyName: d.party.name,
        current: ZERO,
        d1_30: ZERO,
        d31_60: ZERO,
        d61_90: ZERO,
        d90plus: ZERO,
        total: ZERO,
      };
      const overdue = daysBetween(d.dueDate, asOf);
      const key: keyof Bucket = overdue <= 0 ? 'current' : overdue <= 30 ? 'd1_30' : overdue <= 60 ? 'd31_60' : overdue <= 90 ? 'd61_90' : 'd90plus';
      b[key] = (b[key] as Decimal).plus(outstanding) as never;
      b.total = b.total.plus(outstanding);
      byParty.set(d.party.id, b);
    }
    const rows = [...byParty.values()].sort((a, b) => b.total.comparedTo(a.total));
    const totals = (['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus', 'total'] as const).reduce(
      (acc, k) => ({ ...acc, [k]: rows.reduce((s, r) => s.plus(r[k]), ZERO) }),
      {} as Record<string, Decimal>,
    );
    return { asOf, kind, rows, totals };
  }
}

@Roles(Role.ACCOUNTANT)
@Controller('accounting/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  trialBalance(@Query(new ZodPipe(rangeSchema)) r: Range) {
    return this.reports.trialBalance(r.asOf);
  }

  @Get('profit-loss')
  profitLoss(@Query(new ZodPipe(rangeSchema)) r: Range) {
    const now = new Date();
    return this.reports.profitLoss(r.from ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), r.to ?? now);
  }

  @Get('balance-sheet')
  balanceSheet(@Query(new ZodPipe(rangeSchema)) r: Range) {
    return this.reports.balanceSheet(r.asOf);
  }

  @Get('general-ledger/:accountId')
  generalLedger(@Param('accountId') accountId: string, @Query(new ZodPipe(rangeSchema)) r: Range) {
    return this.reports.generalLedger(accountId, r.from, r.to);
  }

  @Get('aging/:kind')
  aging(@Param('kind') kind: string, @Query(new ZodPipe(rangeSchema)) r: Range) {
    return this.reports.aging(kind === 'payables' ? 'payables' : 'receivables', r.asOf);
  }
}
