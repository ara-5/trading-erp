import { BadRequestException, Body, Controller, Get, Injectable, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService } from '../common/common.module';
import { endOfDay, startOfDay } from '../common/dates';
import { D, ZERO } from '../common/money';
import { ZodPipe } from '../common/zod';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { LedgerService, PostingLine } from './ledger.service';

const yearSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Year-end close: zeroes every income and expense account for the fiscal year into retained earnings
 * with a single CLOSING entry, then locks the books through the year end. Years close in order and only
 * the most recent close can be reopened.
 */
@Injectable()
export class ClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  private range(fiscalYearStart: number, year: number) {
    const m = fiscalYearStart - 1;
    return { start: new Date(Date.UTC(year, m, 1)), end: new Date(Date.UTC(year + 1, m, 0)) };
  }

  async overview() {
    const [closes, settings, first] = await Promise.all([
      this.prisma.fiscalYearClose.findMany({ orderBy: { year: 'desc' } }),
      this.prisma.companySettings.findUnique({ where: { id: 1 } }),
      this.prisma.journalEntry.findFirst({ where: { status: 'POSTED' }, orderBy: { date: 'asc' }, select: { date: true } }),
    ]);
    const fyStart = settings?.fiscalYearStart ?? 1;
    let nextYear: number | null = null;
    if (closes[0]) nextYear = closes[0].year + 1;
    else if (first) nextYear = first.date.getUTCMonth() >= fyStart - 1 ? first.date.getUTCFullYear() : first.date.getUTCFullYear() - 1;

    const next = nextYear === null ? null : { year: nextYear, ...this.range(fyStart, nextYear) };
    return {
      lockDate: settings?.lockDate ?? null,
      fiscalYearStart: fyStart,
      closes,
      next: next && { ...next, canClose: next.end < startOfDay(new Date()) },
    };
  }

  close(user: AuthUser, year: number) {
    return this.prisma.$transaction(async (tx) => {
      const settings = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
      const { start, end } = this.range(settings.fiscalYearStart, year);

      if (await tx.fiscalYearClose.findUnique({ where: { year } })) throw new BadRequestException(`Fiscal year ${year} is already closed`);
      if (end >= startOfDay(new Date())) throw new BadRequestException(`Fiscal year ${year} has not ended yet (ends ${iso(end)})`);

      const last = await tx.fiscalYearClose.findFirst({ orderBy: { year: 'desc' } });
      if (last && last.year > year) throw new BadRequestException(`A later fiscal year (${last.year}) is already closed`);
      if (last && last.year !== year - 1) throw new BadRequestException(`Close fiscal year ${last.year + 1} first`);
      if (!last && (await tx.journalEntry.count({ where: { status: 'POSTED', date: { lt: start } } }))) {
        throw new BadRequestException(`There are postings before ${iso(start)}; close fiscal year ${year - 1} first`);
      }
      const drafts = await tx.journalEntry.count({ where: { status: 'DRAFT', date: { gte: start, lte: endOfDay(end) } } });
      if (drafts) throw new BadRequestException(`Post or delete the ${drafts} draft journal entr${drafts === 1 ? 'y' : 'ies'} dated in this year first`);

      const lines = await this.closingLines(tx, start, end);
      if (!lines.lines.length) throw new BadRequestException('There is no income or expense activity to close in this fiscal year');

      const entry = await this.ledger.post(tx, {
        date: end,
        description: `Year-end close FY${year}`,
        reference: `FY${year}`,
        sourceType: 'CLOSING',
        lines: lines.lines,
      });
      const record = await tx.fiscalYearClose.create({
        data: { year, startDate: start, endDate: end, netIncome: lines.netIncome, journalEntryId: entry.id, closedById: user.sub },
      });
      await tx.companySettings.update({ where: { id: 1 }, data: { lockDate: end } });
      await this.audit.log(user.sub, 'close', 'FiscalYear', String(year), { netIncome: lines.netIncome, lockDate: iso(end) }, tx);
      return record;
    });
  }

  reopen(user: AuthUser, year: number) {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.fiscalYearClose.findFirst({ orderBy: { year: 'desc' } });
      if (!last || last.year !== year) throw new BadRequestException('Only the most recently closed fiscal year can be reopened');
      await tx.journalEntry.update({ where: { id: last.journalEntryId }, data: { status: 'VOID' } });
      await tx.fiscalYearClose.delete({ where: { id: last.id } });
      const previous = await tx.fiscalYearClose.findFirst({ orderBy: { year: 'desc' } });
      await tx.companySettings.update({ where: { id: 1 }, data: { lockDate: previous?.endDate ?? null } });
      await this.audit.log(user.sub, 'reopen', 'FiscalYear', String(year), undefined, tx);
      return { ok: true, lockDate: previous?.endDate ?? null };
    });
  }

  private async closingLines(tx: Tx, start: Date, end: Date) {
    const sums = await tx.journalLine.groupBy({
      by: ['accountId'],
      where: { account: { type: { in: ['INCOME', 'EXPENSE'] } }, entry: { status: 'POSTED', date: { gte: start, lte: endOfDay(end) } } },
      _sum: { debit: true, credit: true },
    });
    const lines: PostingLine[] = [];
    let netIncome = ZERO;
    for (const s of sums) {
      const net = D(s._sum.debit).minus(D(s._sum.credit));
      if (net.isZero()) continue;
      netIncome = netIncome.minus(net);
      lines.push(net.gt(0) ? { accountId: s.accountId, credit: net, description: 'Year-end close' } : { accountId: s.accountId, debit: net.neg(), description: 'Year-end close' });
    }
    if (lines.length && !netIncome.isZero()) {
      lines.push(netIncome.gt(0) ? { key: 'RETAINED_EARNINGS', credit: netIncome } : { key: 'RETAINED_EARNINGS', debit: netIncome.neg() });
    }
    return { lines, netIncome };
  }
}

@Roles(Role.ACCOUNTANT)
@Controller('accounting/year-end')
export class ClosingController {
  constructor(private readonly svc: ClosingService) {}

  @Get()
  overview() {
    return this.svc.overview();
  }

  @Post('close')
  close(@CurrentUser() u: AuthUser, @Body(new ZodPipe(yearSchema)) body: z.infer<typeof yearSchema>) {
    return this.svc.close(u, body.year);
  }

  @Roles(Role.ADMIN)
  @Post('reopen')
  reopen(@CurrentUser() u: AuthUser, @Body(new ZodPipe(yearSchema)) body: z.infer<typeof yearSchema>) {
    return this.svc.reopen(u, body.year);
  }
}
