import { BadRequestException, Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { Prisma, Role, StatementLineStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService } from '../common/common.module';
import { daysBetween, startOfDay } from '../common/dates';
import { D, round2 } from '../common/money';
import { listQuerySchema, pageArgs, paged, zDate, zId, zOptStr, ZodPipe } from '../common/zod';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

const MATCH_WINDOW_DAYS = 5;

const importSchema = z.object({
  lines: z
    .array(
      z.object({
        date: zDate,
        description: z.string().trim().min(1).max(500),
        reference: zOptStr,
        amount: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) < 1e12, 'Amount must be non-zero'),
      }),
    )
    .min(1)
    .max(5000),
});
const matchSchema = z.object({ journalLineId: zId });
const createEntrySchema = z.object({ accountId: zId, description: z.string().trim().min(1).max(500).optional() });
const statementQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(StatementLineStatus).optional() });

type ImportDto = z.infer<typeof importSchema>;

/**
 * Bank reconciliation: statement lines are imported per bank account and matched 1:1 to posted journal
 * lines on that account with the same signed amount. Unexplained lines (fees, interest) can be turned
 * into journal entries directly from the statement.
 */
@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  private async bankAccount(tx: Tx, accountId: string) {
    const account = await tx.account.findUnique({ where: { id: accountId } });
    if (!account || account.type !== 'ASSET' || !account.isActive) throw new BadRequestException('Choose an active cash or bank account');
    return account;
  }

  async summary(accountId: string) {
    const account = await this.bankAccount(this.prisma, accountId);
    const unreconciledWhere: Prisma.JournalLineWhereInput = { accountId, entry: { status: 'POSTED' }, statementLine: { is: null } };
    const [statement, last, book, unmatched, unreconciled] = await Promise.all([
      this.prisma.bankStatementLine.aggregate({ where: { accountId, status: { not: 'IGNORED' } }, _sum: { amount: true } }),
      this.prisma.bankStatementLine.findFirst({ where: { accountId }, orderBy: { date: 'desc' }, select: { date: true } }),
      this.prisma.journalLine.aggregate({ where: { accountId, entry: { status: 'POSTED' } }, _sum: { debit: true, credit: true } }),
      this.prisma.bankStatementLine.count({ where: { accountId, status: 'UNMATCHED' } }),
      this.prisma.journalLine.aggregate({ where: unreconciledWhere, _count: true, _sum: { debit: true, credit: true } }),
    ]);
    return {
      account: { id: account.id, code: account.code, name: account.name },
      statementBalance: D(statement._sum.amount),
      lastStatementDate: last?.date ?? null,
      bookBalance: D(book._sum.debit).minus(D(book._sum.credit)),
      unmatchedStatementLines: unmatched,
      unreconciledBookLines: unreconciled._count,
      unreconciledBookAmount: D(unreconciled._sum.debit).minus(D(unreconciled._sum.credit)),
    };
  }

  async statement(accountId: string, q: z.infer<typeof statementQuerySchema>) {
    const where: Prisma.BankStatementLineWhereInput = {
      accountId,
      ...(q.status && { status: q.status }),
      ...(q.search && { OR: [{ description: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.bankStatementLine.findMany({
        where,
        include: { journalLine: { include: { entry: { select: { id: true, number: true, date: true, description: true } } } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.bankStatementLine.count({ where }),
    ]);
    return paged(items, total, q);
  }

  unreconciled(accountId: string) {
    return this.prisma.journalLine.findMany({
      where: { accountId, entry: { status: 'POSTED' }, statementLine: { is: null } },
      include: { entry: { select: { id: true, number: true, date: true, description: true, reference: true } } },
      orderBy: { entry: { date: 'desc' } },
      take: 500,
    });
  }

  import(user: AuthUser, accountId: string, dto: ImportDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.bankAccount(tx, accountId);
      const dates = dto.lines.map((l) => startOfDay(l.date).getTime());
      const existing = await tx.bankStatementLine.findMany({
        where: { accountId, date: { gte: new Date(Math.min(...dates)), lte: new Date(Math.max(...dates)) } },
        select: { date: true, amount: true, description: true },
      });
      const key = (date: Date, amount: Prisma.Decimal.Value, description: string) => `${startOfDay(date).toISOString()}|${D(amount).toFixed(2)}|${description}`;
      const seen = new Set(existing.map((e) => key(e.date, e.amount, e.description)));

      const importBatch = `imp_${Date.now().toString(36)}`;
      const fresh = dto.lines.filter((l) => {
        const k = key(l.date, l.amount, l.description);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      await tx.bankStatementLine.createMany({
        data: fresh.map((l) => ({ accountId, date: startOfDay(l.date), description: l.description, reference: l.reference, amount: round2(D(l.amount)), importBatch })),
      });
      const matched = await this.autoMatchIn(tx, accountId);
      await this.audit.log(user.sub, 'import', 'BankStatement', accountId, { imported: fresh.length, skipped: dto.lines.length - fresh.length, matched }, tx);
      return { imported: fresh.length, skipped: dto.lines.length - fresh.length, matched };
    });
  }

  autoMatch(accountId: string) {
    return this.prisma.$transaction(async (tx) => ({ matched: await this.autoMatchIn(tx, accountId) }));
  }

  /** Greedy match: same signed amount, within a few days, closest date wins, each book line used once. */
  private async autoMatchIn(tx: Tx, accountId: string) {
    const [statementLines, bookLines] = await Promise.all([
      tx.bankStatementLine.findMany({ where: { accountId, status: 'UNMATCHED' }, orderBy: { date: 'asc' } }),
      tx.journalLine.findMany({ where: { accountId, entry: { status: 'POSTED' }, statementLine: { is: null } }, include: { entry: { select: { date: true } } } }),
    ]);
    const used = new Set<string>();
    let matched = 0;
    for (const s of statementLines) {
      let best: (typeof bookLines)[number] | undefined;
      let bestGap = Infinity;
      for (const b of bookLines) {
        if (used.has(b.id) || !D(b.debit).minus(b.credit).equals(s.amount)) continue;
        const gap = Math.abs(daysBetween(b.entry.date, s.date));
        if (gap <= MATCH_WINDOW_DAYS && gap < bestGap) {
          best = b;
          bestGap = gap;
        }
      }
      if (best) {
        used.add(best.id);
        await tx.bankStatementLine.update({ where: { id: s.id }, data: { status: 'MATCHED', journalLineId: best.id } });
        matched++;
      }
    }
    return matched;
  }

  match(user: AuthUser, lineId: string, journalLineId: string) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
      if (line.status === 'MATCHED') throw new BadRequestException('Statement line is already matched');
      const book = await tx.journalLine.findUniqueOrThrow({ where: { id: journalLineId }, include: { entry: true, statementLine: true } });
      if (book.accountId !== line.accountId) throw new BadRequestException('Journal line is on a different account');
      if (book.entry.status !== 'POSTED') throw new BadRequestException('Journal entry is not posted');
      if (book.statementLine) throw new BadRequestException('Journal line is already reconciled');
      if (!D(book.debit).minus(book.credit).equals(line.amount)) throw new BadRequestException('Amounts do not match');
      await this.audit.log(user.sub, 'match', 'BankStatementLine', lineId, { journalLineId }, tx);
      return tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'MATCHED', journalLineId } });
    });
  }

  async setStatus(user: AuthUser, lineId: string, status: 'UNMATCHED' | 'IGNORED') {
    const line = await this.prisma.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
    if (status === 'IGNORED' && line.status === 'MATCHED') throw new BadRequestException('Unmatch the line before ignoring it');
    await this.audit.log(user.sub, status === 'IGNORED' ? 'ignore' : 'unmatch', 'BankStatementLine', lineId);
    return this.prisma.bankStatementLine.update({ where: { id: lineId }, data: { status, journalLineId: null } });
  }

  /** Posts a journal entry for a statement line with no book counterpart (e.g. a bank fee) and matches it. */
  createEntry(user: AuthUser, lineId: string, dto: z.infer<typeof createEntrySchema>) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.bankStatementLine.findUniqueOrThrow({ where: { id: lineId } });
      if (line.status !== 'UNMATCHED') throw new BadRequestException('Only unmatched lines can create entries');
      const counter = await tx.account.findUnique({ where: { id: dto.accountId } });
      if (!counter?.isActive || counter.id === line.accountId) throw new BadRequestException('Choose a different, active account');

      const amount = D(line.amount).abs();
      const moneyIn = D(line.amount).gt(0);
      const entry = await this.ledger.post(tx, {
        date: line.date,
        description: dto.description ?? line.description,
        reference: line.reference ?? undefined,
        sourceType: 'MANUAL',
        lines: moneyIn
          ? [
              { accountId: line.accountId, debit: amount },
              { accountId: counter.id, credit: amount },
            ]
          : [
              { accountId: counter.id, debit: amount },
              { accountId: line.accountId, credit: amount },
            ],
      });
      const bankLine = await tx.journalLine.findFirstOrThrow({ where: { entryId: entry.id, accountId: line.accountId } });
      await this.audit.log(user.sub, 'create-entry', 'BankStatementLine', lineId, { journalEntryId: entry.id }, tx);
      return tx.bankStatementLine.update({ where: { id: lineId }, data: { status: 'MATCHED', journalLineId: bankLine.id } });
    });
  }
}

@Roles(Role.ACCOUNTANT)
@Controller('accounting/bank')
export class BankingController {
  constructor(private readonly svc: BankingService) {}

  @Get(':accountId/summary')
  summary(@Param('accountId') accountId: string) {
    return this.svc.summary(accountId);
  }

  @Get(':accountId/statement')
  statement(@Param('accountId') accountId: string, @Query(new ZodPipe(statementQuerySchema)) q: z.infer<typeof statementQuerySchema>) {
    return this.svc.statement(accountId, q);
  }

  @Get(':accountId/unreconciled')
  unreconciled(@Param('accountId') accountId: string) {
    return this.svc.unreconciled(accountId);
  }

  @Post(':accountId/import')
  import(@CurrentUser() u: AuthUser, @Param('accountId') accountId: string, @Body(new ZodPipe(importSchema)) dto: ImportDto) {
    return this.svc.import(u, accountId, dto);
  }

  @Post(':accountId/auto-match')
  autoMatch(@Param('accountId') accountId: string) {
    return this.svc.autoMatch(accountId);
  }

  @Post('lines/:id/match')
  match(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(matchSchema)) dto: z.infer<typeof matchSchema>) {
    return this.svc.match(u, id, dto.journalLineId);
  }

  @Post('lines/:id/unmatch')
  unmatch(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setStatus(u, id, 'UNMATCHED');
  }

  @Post('lines/:id/ignore')
  ignore(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setStatus(u, id, 'IGNORED');
  }

  @Post('lines/:id/create-entry')
  createEntry(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(createEntrySchema)) dto: z.infer<typeof createEntrySchema>) {
    return this.svc.createEntry(u, id, dto);
  }
}
