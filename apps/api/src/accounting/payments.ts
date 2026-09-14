import { BadRequestException, Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { PaymentDirection, PaymentMethod, Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService, SequenceService } from '../common/common.module';
import { D, round2 } from '../common/money';
import { contains, listQuerySchema, pageArgs, paged, zDate, zId, zOptStr, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';

const optId = z.string().min(1).nullish();

const paymentSchema = z
  .object({
    date: zDate,
    direction: z.nativeEnum(PaymentDirection),
    method: z.nativeEnum(PaymentMethod).default('BANK_TRANSFER'),
    amount: z.coerce.number().positive().max(1e12),
    accountId: zId,
    reference: zOptStr,
    notes: zOptStr,
    customerId: optId,
    supplierId: optId,
    salesInvoiceId: optId,
    purchaseBillId: optId,
  })
  .superRefine((p, ctx) => {
    if (p.direction === 'RECEIVED' && !p.customerId) {
      ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'Customer is required' });
    }
    if (p.direction === 'PAID' && !p.supplierId) {
      ctx.addIssue({ code: 'custom', path: ['supplierId'], message: 'Supplier is required' });
    }
  });
type PaymentDto = z.infer<typeof paymentSchema>;

const voidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const paymentQuerySchema = listQuerySchema.extend({
  direction: z.nativeEnum(PaymentDirection).optional(),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
});
type PaymentQuery = z.infer<typeof paymentQuerySchema>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(q: PaymentQuery) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.direction && { direction: q.direction }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.supplierId && { supplierId: q.supplierId }),
      ...(q.search && { OR: [{ number: contains(q.search) }, { reference: contains(q.search) }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          account: { select: { code: true, name: true } },
          salesInvoice: { select: { id: true, number: true } },
          purchaseBill: { select: { id: true, number: true } },
        },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paged(items, total, q);
  }

  create(user: AuthUser, dto: PaymentDto) {
    const received = dto.direction === 'RECEIVED';
    const amount = round2(D(dto.amount));

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { id: dto.accountId } });
      if (!account || account.type !== 'ASSET' || !account.isActive) {
        throw new BadRequestException('Payment account must be an active cash or bank (asset) account');
      }

      let docNumber: string | undefined;
      if (received && dto.salesInvoiceId) {
        const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: dto.salesInvoiceId } });
        if (inv.customerId !== dto.customerId) throw new BadRequestException('Invoice belongs to a different customer');
        if (inv.status !== 'POSTED' && inv.status !== 'PARTIALLY_PAID') throw new BadRequestException('Invoice is not open for payment');
        const paid = this.applyAmount(D(inv.total), D(inv.amountPaid), amount);
        await tx.salesInvoice.update({ where: { id: inv.id }, data: { amountPaid: paid, status: paid.gte(inv.total) ? 'PAID' : 'PARTIALLY_PAID' } });
        docNumber = inv.number;
      }
      if (!received && dto.purchaseBillId) {
        const bill = await tx.purchaseBill.findUniqueOrThrow({ where: { id: dto.purchaseBillId } });
        if (bill.supplierId !== dto.supplierId) throw new BadRequestException('Bill belongs to a different supplier');
        if (bill.status !== 'POSTED' && bill.status !== 'PARTIALLY_PAID') throw new BadRequestException('Bill is not open for payment');
        const paid = this.applyAmount(D(bill.total), D(bill.amountPaid), amount);
        await tx.purchaseBill.update({ where: { id: bill.id }, data: { amountPaid: paid, status: paid.gte(bill.total) ? 'PAID' : 'PARTIALLY_PAID' } });
        docNumber = bill.number;
      }

      const number = await this.seq.next(tx, received ? 'RCPT' : 'PAY');
      const payment = await tx.payment.create({
        data: {
          number,
          date: dto.date,
          direction: dto.direction,
          method: dto.method,
          amount,
          accountId: dto.accountId,
          reference: dto.reference,
          notes: dto.notes,
          customerId: received ? dto.customerId : null,
          supplierId: received ? null : dto.supplierId,
          salesInvoiceId: received ? (dto.salesInvoiceId ?? null) : null,
          purchaseBillId: received ? null : (dto.purchaseBillId ?? null),
        },
      });

      const entry = await this.ledger.post(tx, {
        date: dto.date,
        description: `${received ? 'Payment received' : 'Payment made'} ${number}${docNumber ? ` for ${docNumber}` : ''}`,
        reference: number,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        lines: received
          ? [
              { accountId: dto.accountId, debit: amount },
              { key: 'ACCOUNTS_RECEIVABLE', credit: amount },
            ]
          : [
              { key: 'ACCOUNTS_PAYABLE', debit: amount },
              { accountId: dto.accountId, credit: amount },
            ],
      });

      await this.audit.log(user.sub, 'create', 'Payment', payment.id, { number, amount }, tx);
      return tx.payment.update({ where: { id: payment.id }, data: { journalEntryId: entry.id } });
    });
  }

  /** Reverses a payment: reopens the invoice/bill balance and voids its journal entry. */
  void(user: AuthUser, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (payment.voidedAt) throw new BadRequestException('Payment is already voided');
      await this.ledger.assertOpenPeriod(tx, payment.date);
      if (payment.journalEntryId && (await tx.bankStatementLine.count({ where: { journalLine: { entryId: payment.journalEntryId } } }))) {
        throw new BadRequestException('Payment is reconciled with a bank statement line; unmatch it first');
      }

      const reopen = (total: Prisma.Decimal, paid: Prisma.Decimal) => {
        const remaining = paid.minus(payment.amount);
        return { amountPaid: remaining, status: remaining.lte(0) ? ('POSTED' as const) : ('PARTIALLY_PAID' as const) };
      };
      if (payment.salesInvoiceId) {
        const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id: payment.salesInvoiceId } });
        await tx.salesInvoice.update({ where: { id: inv.id }, data: reopen(D(inv.total), D(inv.amountPaid)) });
      }
      if (payment.purchaseBillId) {
        const bill = await tx.purchaseBill.findUniqueOrThrow({ where: { id: payment.purchaseBillId } });
        await tx.purchaseBill.update({ where: { id: bill.id }, data: reopen(D(bill.total), D(bill.amountPaid)) });
      }
      if (payment.journalEntryId) await tx.journalEntry.update({ where: { id: payment.journalEntryId }, data: { status: 'VOID' } });

      await this.audit.log(user.sub, 'void', 'Payment', id, { reason }, tx);
      return tx.payment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason } });
    });
  }

  private applyAmount(total: Prisma.Decimal, alreadyPaid: Prisma.Decimal, amount: Prisma.Decimal) {
    const outstanding = total.minus(alreadyPaid);
    if (amount.gt(outstanding)) throw new BadRequestException(`Amount exceeds the outstanding balance of ${outstanding.toFixed(2)}`);
    return alreadyPaid.plus(amount);
  }
}

@Roles(Role.ACCOUNTANT)
@Controller('accounting/payments')
export class PaymentsController {
  constructor(
    private readonly svc: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query(new ZodPipe(paymentQuerySchema)) q: PaymentQuery) {
    return this.svc.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: { customer: true, supplier: true, account: true, salesInvoice: true, purchaseBill: true },
    });
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(paymentSchema)) dto: PaymentDto) {
    return this.svc.create(u, dto);
  }

  @Post(':id/void')
  void(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(voidSchema)) body: z.infer<typeof voidSchema>) {
    return this.svc.void(u, id, body.reason);
  }
}
