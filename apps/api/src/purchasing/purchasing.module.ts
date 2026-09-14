import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { BillStatus, Prisma, PurchaseOrderStatus, Role } from '@prisma/client';
import type { Response } from 'express';
import { linesTable, PdfService, pdfResponse } from '../common/pdf.service';
import { z } from 'zod';
import { AccountingModule } from '../accounting/accounting.module';
import { LedgerService, PostingLine } from '../accounting/ledger.service';
import { allocate } from '../common/allocate';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService, SequenceService } from '../common/common.module';
import { addDays } from '../common/dates';
import { computeLine, D, Decimal, round2, sumTotals, ZERO } from '../common/money';
import { contains, listQuerySchema, pageArgs, paged, zDate, zId, zMoney, zOptStr, zPct, zQty, ZodPipe } from '../common/zod';
import { InventoryModule } from '../inventory/inventory.module';
import { StockService } from '../inventory/stock.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

const supplierSchema = z.object({
  code: z.string().trim().max(30).optional(),
  name: z.string().trim().min(1),
  email: zOptStr,
  phone: zOptStr,
  address: zOptStr,
  taxNumber: zOptStr,
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  isActive: z.boolean().optional(),
});
type SupplierDto = z.infer<typeof supplierSchema>;

const poSchema = z.object({
  supplierId: zId,
  warehouseId: zId,
  date: zDate,
  expectedDate: zDate.nullish(),
  notes: zOptStr,
  lines: z
    .array(z.object({ productId: zId, description: zOptStr, quantity: zQty, unitPrice: zMoney, taxRate: zPct.default(0) }))
    .min(1),
});
type PoDto = z.infer<typeof poSchema>;

const receiveSchema = z.object({
  date: zDate.optional(),
  lines: z.array(z.object({ lineId: zId, quantity: zQty })).optional(),
});
type ReceiveDto = z.infer<typeof receiveSchema>;

const billSchema = z.object({
  supplierId: zId,
  supplierRef: zOptStr,
  date: zDate,
  dueDate: zDate.nullish(),
  notes: zOptStr,
  lines: z
    .array(
      z
        .object({
          productId: z.string().min(1).nullish(),
          accountId: z.string().min(1).nullish(),
          description: z.string().trim().min(1),
          quantity: zQty,
          unitPrice: zMoney,
          taxRate: zPct.default(0),
        })
        .refine((l) => l.productId || l.accountId, { message: 'Choose a product or an expense account' }),
    )
    .min(1),
});
type BillDto = z.infer<typeof billSchema>;

const poQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(PurchaseOrderStatus).optional(), supplierId: z.string().optional() });
const billQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(BillStatus).optional(), supplierId: z.string().optional() });
type PoQuery = z.infer<typeof poQuerySchema>;
type BillQuery = z.infer<typeof billQuerySchema>;

const productBrief = { select: { id: true, sku: true, name: true, uom: true, trackInventory: true } } as const;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
  ) {}

  // ── Suppliers ──

  async listSuppliers(q: z.infer<typeof listQuerySchema>) {
    const where: Prisma.SupplierWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.search && { OR: [{ name: contains(q.search) }, { code: contains(q.search) }, { email: contains(q.search) }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(q) }),
      this.prisma.supplier.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async getSupplier(id: string) {
    const [supplier, open] = await Promise.all([
      this.prisma.supplier.findUniqueOrThrow({
        where: { id },
        include: {
          purchaseOrders: { take: 10, orderBy: { date: 'desc' } },
          bills: { take: 10, orderBy: { date: 'desc' } },
        },
      }),
      this.prisma.purchaseBill.aggregate({
        where: { supplierId: id, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
        _sum: { total: true, amountPaid: true },
      }),
    ]);
    return { ...supplier, outstanding: D(open._sum.total).minus(D(open._sum.amountPaid)) };
  }

  createSupplier(user: AuthUser, dto: SupplierDto) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({ data: { ...dto, code: dto.code || (await this.seq.next(tx, 'SUP')) } });
      await this.audit.log(user.sub, 'create', 'Supplier', supplier.id, undefined, tx);
      return supplier;
    });
  }

  updateSupplier(id: string, dto: Partial<SupplierDto>) {
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  // ── Purchase orders ──

  async listOrders(q: PoQuery) {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.supplierId && { supplierId: q.supplierId }),
      ...(q.search && { OR: [{ number: contains(q.search) }, { supplier: { name: contains(q.search) } }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { supplier: { select: { id: true, name: true } }, warehouse: { select: { code: true } } },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return paged(items, total, q);
  }

  getOrder(id: string) {
    return this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        lines: { include: { product: productBrief } },
        bills: { select: { id: true, number: true, status: true, total: true } },
      },
    });
  }

  private priceLines(lines: PoDto['lines']) {
    const priced = lines.map((l) => ({ ...l, ...computeLine(l) }));
    return { priced, totals: sumTotals(priced) };
  }

  createOrder(user: AuthUser, dto: PoDto) {
    const { priced, totals } = this.priceLines(dto.lines);
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          number: await this.seq.next(tx, 'PO'),
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          date: dto.date,
          expectedDate: dto.expectedDate,
          notes: dto.notes,
          ...totals,
          lines: { create: priced },
        },
      });
      await this.audit.log(user.sub, 'create', 'PurchaseOrder', po.id, undefined, tx);
      return po;
    });
  }

  updateOrder(user: AuthUser, id: string, dto: PoDto) {
    const { priced, totals } = this.priceLines(dto.lines);
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      if (po.status !== 'DRAFT') throw new BadRequestException('Only draft purchase orders can be edited');
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          date: dto.date,
          expectedDate: dto.expectedDate,
          notes: dto.notes,
          ...totals,
          lines: { create: priced },
        },
      });
      await this.audit.log(user.sub, 'update', 'PurchaseOrder', id, undefined, tx);
      return updated;
    });
  }

  async setOrderStatus(user: AuthUser, id: string, action: 'approve' | 'cancel') {
    const po = await this.prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (action === 'approve' && po.status !== 'DRAFT') throw new BadRequestException('Only drafts can be approved');
    if (action === 'cancel') {
      if (po.status !== 'DRAFT' && po.status !== 'APPROVED') throw new BadRequestException('This order can no longer be cancelled');
      if (po.lines.some((l) => D(l.receivedQty).gt(0))) throw new BadRequestException('Goods have already been received');
    }
    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: action === 'approve' ? 'APPROVED' : 'CANCELLED' },
    });
    await this.audit.log(user.sub, action, 'PurchaseOrder', id);
    return updated;
  }

  receive(user: AuthUser, id: string, dto: ReceiveDto) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: { include: { product: true } } } });
      if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
        throw new BadRequestException('Only approved purchase orders can be received');
      }
      const date = dto.date ?? new Date();
      const requests =
        dto.lines ??
        po.lines
          .map((l) => ({ lineId: l.id, quantity: D(l.quantity).minus(l.receivedQty) }))
          .filter((r) => r.quantity.gt(0));
      if (!requests.length) throw new BadRequestException('Nothing left to receive');

      let value = ZERO;
      for (const r of requests) {
        const line = po.lines.find((l) => l.id === r.lineId);
        if (!line) throw new BadRequestException('Line does not belong to this order');
        const qty = D(r.quantity);
        const remaining = D(line.quantity).minus(line.receivedQty);
        if (qty.gt(remaining)) throw new BadRequestException(`Cannot receive more than the remaining ${remaining} of ${line.product.sku}`);
        const res = await this.stock.receive(tx, {
          type: 'RECEIPT',
          productId: line.productId,
          warehouseId: po.warehouseId,
          quantity: qty,
          unitCost: line.unitPrice,
          date,
          reference: po.number,
          sourceType: 'PurchaseOrder',
          sourceId: po.id,
        });
        value = value.plus(res.value);
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: qty } } });
        line.receivedQty = D(line.receivedQty).plus(qty);
      }

      if (value.gt(0)) {
        await this.ledger.post(tx, {
          date,
          description: `Goods received for ${po.number}`,
          reference: po.number,
          sourceType: 'STOCK',
          sourceId: po.id,
          lines: [
            { key: 'INVENTORY', debit: value },
            { key: 'GOODS_RECEIVED_NOT_BILLED', credit: value },
          ],
        });
      }
      const complete = po.lines.every((l) => D(l.receivedQty).gte(l.quantity));
      await this.audit.log(user.sub, 'receive', 'PurchaseOrder', po.id, requests, tx);
      return tx.purchaseOrder.update({ where: { id }, data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    });
  }

  async orderPdf(id: string) {
    const po = await this.getOrder(id);
    const buffer = await this.pdf.render((f) => ({
      title: 'Purchase Order',
      number: po.number,
      status: po.status === 'DRAFT' ? 'Draft — not approved' : undefined,
      party: { label: 'Supplier', name: po.supplier.name, lines: [po.supplier.address, po.supplier.email, po.supplier.phone] },
      meta: [
        ['Order date', f.date(po.date)],
        ['Expected', f.date(po.expectedDate)],
        ['Deliver to', po.warehouse.name],
        ['Payment terms', `${po.supplier.paymentTermsDays} days`],
      ],
      ...linesTable(po.lines, f),
      totals: [
        ['Subtotal', f.money(po.subtotal)],
        ['Tax', f.money(po.taxTotal)],
        ['Total', f.money(po.total), true],
      ],
      notes: po.notes,
    }));
    return { buffer, filename: `${po.number}.pdf` };
  }

  billFromOrder(user: AuthUser, id: string, billDate?: Date) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { supplier: true, lines: { include: { product: true } } } });
      const lines = po.lines
        .map((l) => ({ l, qty: D(l.receivedQty).minus(l.billedQty) }))
        .filter(({ qty }) => qty.gt(0))
        .map(({ l, qty }) => {
          const base = { quantity: qty, unitPrice: l.unitPrice, taxRate: l.taxRate };
          return { productId: l.productId, description: l.description ?? l.product.name, ...base, ...computeLine(base) };
        });
      if (!lines.length) throw new BadRequestException('There are no received, unbilled quantities on this order');
      const date = billDate ?? new Date();
      const bill = await tx.purchaseBill.create({
        data: {
          number: await this.seq.next(tx, 'BILL'),
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          date,
          dueDate: addDays(date, po.supplier.paymentTermsDays),
          ...sumTotals(lines),
          lines: { create: lines },
        },
      });
      await this.audit.log(user.sub, 'create', 'PurchaseBill', bill.id, { fromOrder: po.number }, tx);
      return bill;
    });
  }

  // ── Bills ──

  async listBills(q: BillQuery) {
    const where: Prisma.PurchaseBillWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.supplierId && { supplierId: q.supplierId }),
      ...(q.search && {
        OR: [{ number: contains(q.search) }, { supplierRef: contains(q.search) }, { supplier: { name: contains(q.search) } }],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.purchaseBill.findMany({
        where,
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.purchaseBill.count({ where }),
    ]);
    return paged(items, total, q);
  }

  getBill(id: string) {
    return this.prisma.purchaseBill.findUniqueOrThrow({
      where: { id },
      include: {
        supplier: true,
        purchaseOrder: { select: { id: true, number: true } },
        lines: { include: { product: productBrief, account: { select: { id: true, code: true, name: true } } } },
        payments: { orderBy: { date: 'asc' } },
      },
    });
  }

  private async priceBill(tx: Tx, dto: BillDto) {
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: dto.supplierId } });
    const lines = dto.lines.map((l) => ({
      productId: l.productId ?? null,
      accountId: l.accountId ?? null,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      ...computeLine(l),
    }));
    return { supplier, lines, totals: sumTotals(lines) };
  }

  createBill(user: AuthUser, dto: BillDto) {
    return this.prisma.$transaction(async (tx) => {
      const { supplier, lines, totals } = await this.priceBill(tx, dto);
      const bill = await tx.purchaseBill.create({
        data: {
          number: await this.seq.next(tx, 'BILL'),
          supplierId: dto.supplierId,
          supplierRef: dto.supplierRef,
          date: dto.date,
          dueDate: dto.dueDate ?? addDays(dto.date, supplier.paymentTermsDays),
          notes: dto.notes,
          ...totals,
          lines: { create: lines },
        },
      });
      await this.audit.log(user.sub, 'create', 'PurchaseBill', bill.id, undefined, tx);
      return bill;
    });
  }

  updateBill(user: AuthUser, id: string, dto: BillDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.purchaseBill.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'DRAFT') throw new BadRequestException('Only draft bills can be edited');
      const { supplier, lines, totals } = await this.priceBill(tx, dto);
      if (current.purchaseOrderId && dto.supplierId !== current.supplierId) {
        throw new BadRequestException('Supplier cannot change on a bill created from a purchase order');
      }
      await tx.purchaseBillLine.deleteMany({ where: { billId: id } });
      const bill = await tx.purchaseBill.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          supplierRef: dto.supplierRef,
          date: dto.date,
          dueDate: dto.dueDate ?? addDays(dto.date, supplier.paymentTermsDays),
          notes: dto.notes,
          ...totals,
          lines: { create: lines },
        },
      });
      await this.audit.log(user.sub, 'update', 'PurchaseBill', id, undefined, tx);
      return bill;
    });
  }

  postBill(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.purchaseBill.findUniqueOrThrow({ where: { id }, include: { lines: { include: { product: true } } } });
      if (bill.status !== 'DRAFT') throw new BadRequestException('Only draft bills can be posted');

      const po = bill.purchaseOrderId
        ? await tx.purchaseOrder.findUniqueOrThrow({ where: { id: bill.purchaseOrderId }, include: { lines: true } })
        : null;
      const used = new Map<string, Decimal>();
      const debits: PostingLine[] = [];

      for (const l of bill.lines) {
        const tracked = !!l.product?.trackInventory;
        if (tracked && !po) {
          throw new BadRequestException(`${l.product!.sku} tracks stock; bill it from a purchase order so the goods are received`);
        }

        if (po && l.productId) {
          const alloc = allocate(po.lines, l.productId, D(l.quantity), (pl) => D(pl.receivedQty).minus(pl.billedQty), used);
          if (!alloc) throw new BadRequestException(`Billed quantity of ${l.description} exceeds the received, unbilled quantity`);
          for (const a of alloc) {
            await tx.purchaseOrderLine.update({ where: { id: a.line.id }, data: { billedQty: { increment: a.qty } } });
          }
          if (tracked) {
            // Clear GRNI at the receipt cost; any price difference is a purchase price variance.
            const receiptValue = round2(alloc.reduce((s, a) => s.plus(a.qty.mul(a.line.unitPrice)), ZERO));
            const variance = D(l.lineTotal).minus(receiptValue);
            debits.push({ key: 'GOODS_RECEIVED_NOT_BILLED', debit: receiptValue, description: l.description });
            if (!variance.isZero()) {
              debits.push(
                variance.gt(0)
                  ? { key: 'INVENTORY_ADJUSTMENT', debit: variance, description: `Price variance ${l.description}` }
                  : { key: 'INVENTORY_ADJUSTMENT', credit: variance.neg(), description: `Price variance ${l.description}` },
              );
            }
            continue;
          }
        }
        debits.push(
          l.accountId
            ? { accountId: l.accountId, debit: l.lineTotal, description: l.description }
            : { key: 'COST_OF_GOODS_SOLD', debit: l.lineTotal, description: l.description },
        );
      }

      const entry = await this.ledger.post(tx, {
        date: bill.date,
        description: `Purchase bill ${bill.number}${bill.supplierRef ? ` (${bill.supplierRef})` : ''}`,
        reference: bill.number,
        sourceType: 'PURCHASE_BILL',
        sourceId: bill.id,
        lines: [...debits, { key: 'TAX_RECEIVABLE', debit: bill.taxTotal }, { key: 'ACCOUNTS_PAYABLE', credit: bill.total }],
      });
      await this.audit.log(user.sub, 'post', 'PurchaseBill', id, undefined, tx);
      return tx.purchaseBill.update({ where: { id }, data: { status: 'POSTED', journalEntryId: entry.id } });
    });
  }

  voidBill(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.purchaseBill.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (bill.status === 'DRAFT') {
        await tx.purchaseBill.delete({ where: { id } });
        return { deleted: true };
      }
      if (bill.status !== 'POSTED') throw new BadRequestException('Only unpaid posted bills can be voided');
      await this.ledger.assertOpenPeriod(tx, bill.date);
      if (bill.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: bill.purchaseOrderId }, include: { lines: true } });
        const used = new Map<string, Decimal>();
        for (const l of bill.lines.filter((x) => x.productId)) {
          for (const a of allocate(po.lines, l.productId!, D(l.quantity), (pl) => D(pl.billedQty), used) ?? []) {
            await tx.purchaseOrderLine.update({ where: { id: a.line.id }, data: { billedQty: { decrement: a.qty } } });
          }
        }
      }
      if (bill.journalEntryId) await tx.journalEntry.update({ where: { id: bill.journalEntryId }, data: { status: 'VOID' } });
      await this.audit.log(user.sub, 'void', 'PurchaseBill', id, undefined, tx);
      return tx.purchaseBill.update({ where: { id }, data: { status: 'VOID' } });
    });
  }
}

@Roles(Role.PURCHASING, Role.INVENTORY, Role.ACCOUNTANT)
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly svc: PurchasingService) {}

  @Get('suppliers')
  listSuppliers(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.svc.listSuppliers(q);
  }

  @Get('suppliers/:id')
  getSupplier(@Param('id') id: string) {
    return this.svc.getSupplier(id);
  }

  @Post('suppliers')
  createSupplier(@CurrentUser() u: AuthUser, @Body(new ZodPipe(supplierSchema)) dto: SupplierDto) {
    return this.svc.createSupplier(u, dto);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id') id: string, @Body(new ZodPipe(supplierSchema.partial())) dto: Partial<SupplierDto>) {
    return this.svc.updateSupplier(id, dto);
  }

  @Get('orders')
  listOrders(@Query(new ZodPipe(poQuerySchema)) q: PoQuery) {
    return this.svc.listOrders(q);
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.svc.getOrder(id);
  }

  @Get('orders/:id/pdf')
  async orderPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.svc.orderPdf(id);
    return pdfResponse(res, buffer, filename);
  }

  @Roles(Role.PURCHASING)
  @Post('orders')
  createOrder(@CurrentUser() u: AuthUser, @Body(new ZodPipe(poSchema)) dto: PoDto) {
    return this.svc.createOrder(u, dto);
  }

  @Roles(Role.PURCHASING)
  @Put('orders/:id')
  updateOrder(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(poSchema)) dto: PoDto) {
    return this.svc.updateOrder(u, id, dto);
  }

  @Roles(Role.PURCHASING)
  @Post('orders/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setOrderStatus(u, id, 'approve');
  }

  @Roles(Role.PURCHASING)
  @Post('orders/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setOrderStatus(u, id, 'cancel');
  }

  @Roles(Role.INVENTORY, Role.PURCHASING)
  @Post('orders/:id/receive')
  receive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(receiveSchema)) dto: ReceiveDto) {
    return this.svc.receive(u, id, dto);
  }

  @Roles(Role.ACCOUNTANT, Role.PURCHASING)
  @Post('orders/:id/bill')
  billFromOrder(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ date: zDate.optional() }))) body: { date?: Date }) {
    return this.svc.billFromOrder(u, id, body.date);
  }

  @Get('bills')
  listBills(@Query(new ZodPipe(billQuerySchema)) q: BillQuery) {
    return this.svc.listBills(q);
  }

  @Get('bills/:id')
  getBill(@Param('id') id: string) {
    return this.svc.getBill(id);
  }

  @Roles(Role.ACCOUNTANT, Role.PURCHASING)
  @Post('bills')
  createBill(@CurrentUser() u: AuthUser, @Body(new ZodPipe(billSchema)) dto: BillDto) {
    return this.svc.createBill(u, dto);
  }

  @Roles(Role.ACCOUNTANT, Role.PURCHASING)
  @Put('bills/:id')
  updateBill(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(billSchema)) dto: BillDto) {
    return this.svc.updateBill(u, id, dto);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('bills/:id/post')
  postBill(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.postBill(u, id);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('bills/:id/void')
  voidBill(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.voidBill(u, id);
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
