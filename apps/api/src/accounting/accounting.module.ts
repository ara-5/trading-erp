import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AccountType, JournalStatus, Prisma, Role, SourceType } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService, SequenceService } from '../common/common.module';
import { endOfDay } from '../common/dates';
import { D, round2 } from '../common/money';
import { contains, listQuerySchema, pageArgs, paged, zDate, zId, zMoney, zOptStr, zPct, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService, naturalBalance } from './ledger.service';
import { AnalyticsController, AnalyticsService } from './analytics';
import { BankingController, BankingService } from './banking';
import { ClosingController, ClosingService } from './closing';
import { PaymentsController, PaymentsService } from './payments';
import { ReportsController, ReportsService } from './reports';

const accountSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(AccountType),
  parentId: z.string().min(1).nullish(),
  isActive: z.boolean().optional(),
});
type AccountDto = z.infer<typeof accountSchema>;

const taxRateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  rate: zPct,
  isActive: z.boolean().optional(),
});
type TaxRateDto = z.infer<typeof taxRateSchema>;

const journalSchema = z.object({
  date: zDate,
  description: z.string().trim().min(1),
  reference: zOptStr,
  lines: z
    .array(z.object({ accountId: zId, debit: zMoney.default(0), credit: zMoney.default(0), description: zOptStr }))
    .min(2),
});
type JournalDto = z.infer<typeof journalSchema>;

const journalQuerySchema = listQuerySchema.extend({
  from: zDate.optional(),
  to: zDate.optional(),
  status: z.nativeEnum(JournalStatus).optional(),
  sourceType: z.nativeEnum(SourceType).optional(),
});
type JournalQuery = z.infer<typeof journalQuerySchema>;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive: boolean) {
    const [accounts, sums] = await Promise.all([
      this.prisma.account.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.journalLine.groupBy({
        by: ['accountId'],
        where: { entry: { status: 'POSTED' } },
        _sum: { debit: true, credit: true },
      }),
    ]);
    const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
    return accounts.map((a) => {
      const s = byId.get(a.id);
      return { ...a, balance: naturalBalance(a.type, D(s?.debit), D(s?.credit)) };
    });
  }

  async create(user: AuthUser, dto: AccountDto) {
    await this.assertParent(dto.parentId, dto.type);
    const account = await this.prisma.account.create({ data: dto });
    await this.audit.log(user.sub, 'create', 'Account', account.id, dto);
    return account;
  }

  async update(user: AuthUser, id: string, dto: Partial<AccountDto>) {
    const current = await this.prisma.account.findUniqueOrThrow({ where: { id } });
    await this.assertParent(dto.parentId, dto.type ?? current.type, id);
    const account = await this.prisma.account.update({ where: { id }, data: dto });
    await this.audit.log(user.sub, 'update', 'Account', id, dto);
    return account;
  }

  async remove(user: AuthUser, id: string) {
    const [lines, children, mapped] = await Promise.all([
      this.prisma.journalLine.count({ where: { accountId: id } }),
      this.prisma.account.count({ where: { parentId: id } }),
      this.prisma.systemAccount.count({ where: { accountId: id } }),
    ]);
    if (lines) throw new BadRequestException('Account has journal lines; deactivate it instead');
    if (children) throw new BadRequestException('Account has sub-accounts');
    if (mapped) throw new BadRequestException('Account is mapped as a system account');
    await this.prisma.account.delete({ where: { id } });
    await this.audit.log(user.sub, 'delete', 'Account', id);
    return { ok: true };
  }

  private async assertParent(parentId: string | null | undefined, type: AccountType, selfId?: string) {
    if (!parentId) return;
    let cursor = await this.prisma.account.findUnique({ where: { id: parentId } });
    if (!cursor) throw new BadRequestException('Parent account not found');
    if (cursor.type !== type) throw new BadRequestException('Parent account must be of the same type');
    while (cursor) {
      if (cursor.id === selfId) throw new BadRequestException('An account cannot be nested under itself');
      cursor = cursor.parentId ? await this.prisma.account.findUnique({ where: { id: cursor.parentId } }) : null;
    }
  }
}

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(q: JournalQuery) {
    const where: Prisma.JournalEntryWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.sourceType && { sourceType: q.sourceType }),
      ...((q.from || q.to) && { date: { gte: q.from, lte: q.to && endOfDay(q.to) } }),
      ...(q.search && {
        OR: [{ number: contains(q.search) }, { description: contains(q.search) }, { reference: contains(q.search) }],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: { select: { debit: true } } },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.journalEntry.count({ where }),
    ]);
    const items = rows.map(({ lines, ...e }) => ({ ...e, amount: lines.reduce((s, l) => s.plus(l.debit), D(0)) }));
    return paged(items, total, q);
  }

  get(id: string) {
    return this.prisma.journalEntry.findUniqueOrThrow({
      where: { id },
      include: { lines: { include: { account: { select: { id: true, code: true, name: true } } } } },
    });
  }

  create(user: AuthUser, dto: JournalDto) {
    const lines = this.normalize(dto.lines);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({
        data: {
          number: await this.seq.next(tx, 'JE'),
          date: dto.date,
          description: dto.description,
          reference: dto.reference,
          sourceType: 'MANUAL',
          status: 'DRAFT',
          lines: { create: lines },
        },
      });
      await this.audit.log(user.sub, 'create', 'JournalEntry', entry.id, undefined, tx);
      return entry;
    });
  }

  async update(user: AuthUser, id: string, dto: JournalDto) {
    const lines = this.normalize(dto.lines);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
      if (entry.status !== 'DRAFT' || entry.sourceType !== 'MANUAL') {
        throw new BadRequestException('Only draft manual entries can be edited');
      }
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      const updated = await tx.journalEntry.update({
        where: { id },
        data: { date: dto.date, description: dto.description, reference: dto.reference, lines: { create: lines } },
      });
      await this.audit.log(user.sub, 'update', 'JournalEntry', id, undefined, tx);
      return updated;
    });
  }

  async post(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } });
      if (entry.status !== 'DRAFT') throw new BadRequestException('Entry is not a draft');
      await this.ledger.assertOpenPeriod(tx, entry.date);
      const inactive = entry.lines.find((l) => !l.account.isActive);
      if (inactive) throw new BadRequestException(`Account ${inactive.account.code} is inactive`);
      this.ledger.assertBalanced(entry.lines.map((l) => ({ debit: D(l.debit), credit: D(l.credit) })));
      const posted = await tx.journalEntry.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date() } });
      await this.audit.log(user.sub, 'post', 'JournalEntry', id, undefined, tx);
      return posted;
    });
  }

  async void(user: AuthUser, id: string) {
    const entry = await this.prisma.journalEntry.findUniqueOrThrow({ where: { id } });
    if (entry.status !== 'POSTED' || entry.sourceType !== 'MANUAL') {
      throw new BadRequestException('Only posted manual entries can be voided here; void the source document instead');
    }
    await this.ledger.assertOpenPeriod(this.prisma, entry.date);
    if (await this.prisma.bankStatementLine.count({ where: { journalLine: { entryId: id } } })) {
      throw new BadRequestException('This entry is reconciled with a bank statement line; unmatch it first');
    }
    const voided = await this.prisma.journalEntry.update({ where: { id }, data: { status: 'VOID' } });
    await this.audit.log(user.sub, 'void', 'JournalEntry', id);
    return voided;
  }

  async remove(user: AuthUser, id: string) {
    const entry = await this.prisma.journalEntry.findUniqueOrThrow({ where: { id } });
    if (entry.status !== 'DRAFT') throw new BadRequestException('Only drafts can be deleted');
    await this.prisma.journalEntry.delete({ where: { id } });
    await this.audit.log(user.sub, 'delete', 'JournalEntry', id);
    return { ok: true };
  }

  private normalize(lines: JournalDto['lines']) {
    return lines.map((l) => {
      if (l.debit > 0 && l.credit > 0) throw new BadRequestException('A line cannot have both a debit and a credit');
      return { accountId: l.accountId, debit: round2(D(l.debit)), credit: round2(D(l.credit)), description: l.description };
    });
  }
}

@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly journals: JournalService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('accounts')
  listAccounts(@Query('includeInactive') includeInactive?: string) {
    return this.accounts.list(includeInactive === 'true');
  }

  @Roles(Role.ACCOUNTANT)
  @Post('accounts')
  createAccount(@CurrentUser() u: AuthUser, @Body(new ZodPipe(accountSchema)) dto: AccountDto) {
    return this.accounts.create(u, dto);
  }

  @Roles(Role.ACCOUNTANT)
  @Patch('accounts/:id')
  updateAccount(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(accountSchema.partial())) dto: Partial<AccountDto>) {
    return this.accounts.update(u, id, dto);
  }

  @Roles(Role.ACCOUNTANT)
  @Delete('accounts/:id')
  removeAccount(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.accounts.remove(u, id);
  }

  @Get('tax-rates')
  listTaxRates() {
    return this.prisma.taxRate.findMany({ orderBy: { rate: 'desc' } });
  }

  @Roles(Role.ACCOUNTANT)
  @Post('tax-rates')
  createTaxRate(@Body(new ZodPipe(taxRateSchema)) dto: TaxRateDto) {
    return this.prisma.taxRate.create({ data: dto });
  }

  @Roles(Role.ACCOUNTANT)
  @Patch('tax-rates/:id')
  updateTaxRate(@Param('id') id: string, @Body(new ZodPipe(taxRateSchema.partial())) dto: Partial<TaxRateDto>) {
    return this.prisma.taxRate.update({ where: { id }, data: dto });
  }

  @Roles(Role.ACCOUNTANT)
  @Get('journals')
  listJournals(@Query(new ZodPipe(journalQuerySchema)) q: JournalQuery) {
    return this.journals.list(q);
  }

  @Roles(Role.ACCOUNTANT)
  @Get('journals/:id')
  getJournal(@Param('id') id: string) {
    return this.journals.get(id);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('journals')
  createJournal(@CurrentUser() u: AuthUser, @Body(new ZodPipe(journalSchema)) dto: JournalDto) {
    return this.journals.create(u, dto);
  }

  @Roles(Role.ACCOUNTANT)
  @Put('journals/:id')
  updateJournal(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(journalSchema)) dto: JournalDto) {
    return this.journals.update(u, id, dto);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('journals/:id/post')
  postJournal(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.journals.post(u, id);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('journals/:id/void')
  voidJournal(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.journals.void(u, id);
  }

  @Roles(Role.ACCOUNTANT)
  @Delete('journals/:id')
  removeJournal(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.journals.remove(u, id);
  }
}

@Module({
  controllers: [AccountingController, PaymentsController, ReportsController, ClosingController, BankingController, AnalyticsController],
  providers: [LedgerService, AccountsService, JournalService, PaymentsService, ReportsService, ClosingService, BankingService, AnalyticsService],
  exports: [LedgerService, ReportsService],
})
export class AccountingModule {}
