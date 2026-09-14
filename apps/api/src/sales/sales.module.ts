import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { InvoiceStatus, LeadStatus, Prisma, QuotationStatus, Role, SalesOrderStatus } from '@prisma/client';
import type { Response } from 'express';
import { linesTable, PdfService, pdfResponse } from '../common/pdf.service';
import { z } from 'zod';
import { AccountingModule } from '../accounting/accounting.module';
import { LedgerService } from '../accounting/ledger.service';
import { allocate } from '../common/allocate';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService, SequenceService } from '../common/common.module';
import { addDays } from '../common/dates';
import { computeLine, D, Decimal, sumTotals, ZERO } from '../common/money';
import { contains, listQuerySchema, pageArgs, paged, zDate, zId, zMoney, zOptStr, zPct, zQty, ZodPipe } from '../common/zod';
import { InventoryModule } from '../inventory/inventory.module';
import { StockService } from '../inventory/stock.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

// ── Schemas ──

const customerSchema = z.object({
  code: z.string().trim().max(30).optional(),
  name: z.string().trim().min(1),
  email: zOptStr,
  phone: zOptStr,
  address: zOptStr,
  taxNumber: zOptStr,
  creditLimit: zMoney.default(0),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  isActive: z.boolean().optional(),
});
type CustomerDto = z.infer<typeof customerSchema>;

const leadSchema = z.object({
  name: z.string().trim().min(1),
  company: zOptStr,
  email: zOptStr,
  phone: zOptStr,
  source: zOptStr,
  status: z.nativeEnum(LeadStatus).default('NEW'),
  estimatedValue: zMoney.default(0),
  notes: zOptStr,
  ownerId: z.string().min(1).nullish(),
});
type LeadDto = z.infer<typeof leadSchema>;

const lineSchema = z.object({
  productId: zId,
  description: zOptStr,
  quantity: zQty,
  unitPrice: zMoney.optional(),
  discountPct: zPct.default(0),
  taxRate: zPct.optional(),
});
const invoiceLineSchema = lineSchema
  .extend({ productId: z.string().min(1).nullish() })
  .refine((l) => l.productId || (l.description && l.unitPrice !== undefined), {
    message: 'Lines without a product need a description and a unit price',
  });
type LineInput = z.infer<typeof invoiceLineSchema>;

const quotationSchema = z.object({ customerId: zId, date: zDate, validUntil: zDate.nullish(), notes: zOptStr, lines: z.array(lineSchema).min(1) });
const orderSchema = z.object({ customerId: zId, warehouseId: zId, date: zDate, notes: zOptStr, lines: z.array(lineSchema).min(1) });
const invoiceSchema = z.object({ customerId: zId, date: zDate, dueDate: zDate.nullish(), notes: zOptStr, lines: z.array(invoiceLineSchema).min(1) });
const deliverSchema = z.object({ date: zDate.optional(), lines: z.array(z.object({ lineId: zId, quantity: zQty })).optional() });
type QuotationDto = z.infer<typeof quotationSchema>;
type OrderDto = z.infer<typeof orderSchema>;
type InvoiceDto = z.infer<typeof invoiceSchema>;
type DeliverDto = z.infer<typeof deliverSchema>;

const leadQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(LeadStatus).optional() });
const quotationQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(QuotationStatus).optional(), customerId: z.string().optional() });
const orderQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(SalesOrderStatus).optional(), customerId: z.string().optional() });
const invoiceQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(InvoiceStatus).optional(), customerId: z.string().optional() });

const productBrief = { select: { id: true, sku: true, name: true, uom: true, trackInventory: true } } as const;
const customerBrief = { select: { id: true, code: true, name: true } } as const;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
  ) {}

  /** Fills default price/tax from the product master and computes line and document totals. */
  private async priceLines(tx: Tx, lines: LineInput[]) {
    const ids = lines.map((l) => l.productId).filter((id): id is string => !!id);
    const products = await tx.product.findMany({ where: { id: { in: ids } }, include: { taxRate: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const priced = lines.map((l) => {
      const product = l.productId ? byId.get(l.productId) : undefined;
      if (l.productId && !product) throw new BadRequestException('Product not found');
      if (product && !product.isActive) throw new BadRequestException(`${product.sku} is inactive`);
      const unitPrice = l.unitPrice ?? Number(product!.salePrice);
      const taxRate = l.taxRate ?? Number(product?.taxRate?.rate ?? 0);
      const base = { quantity: l.quantity, unitPrice, discountPct: l.discountPct, taxRate };
      return {
        productId: product?.id ?? null,
        description: l.description ?? product!.name,
        ...base,
        ...computeLine(base),
        trackInventory: !!product?.trackInventory,
      };
    });
    const totals = sumTotals(priced);
    const rows = priced.map(({ trackInventory: _t, ...r }) => r);
    return { rows, totals, hasTracked: priced.some((p) => p.trackInventory) };
  }

  // ── Customers ──

  async listCustomers(q: z.infer<typeof listQuerySchema>) {
    const where: Prisma.CustomerWhereInput = {
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.search && { OR: [{ name: contains(q.search) }, { code: contains(q.search) }, { email: contains(q.search) }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(q) }),
      this.prisma.customer.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async getCustomer(id: string) {
    const [customer, balance] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({
        where: { id },
        include: {
          quotations: { take: 10, orderBy: { date: 'desc' } },
          salesOrders: { take: 10, orderBy: { date: 'desc' } },
          invoices: { take: 10, orderBy: { date: 'desc' } },
          payments: { take: 10, orderBy: { date: 'desc' } },
        },
      }),
      this.outstanding(this.prisma, id),
    ]);
    return { ...customer, outstanding: balance };
  }

  private async outstanding(tx: Tx, customerId: string) {
    const agg = await tx.salesInvoice.aggregate({
      where: { customerId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
      _sum: { total: true, amountPaid: true },
    });
    return D(agg._sum.total).minus(D(agg._sum.amountPaid));
  }

  createCustomer(user: AuthUser, dto: CustomerDto) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data: { ...dto, code: dto.code || (await this.seq.next(tx, 'CUST')) } });
      await this.audit.log(user.sub, 'create', 'Customer', customer.id, undefined, tx);
      return customer;
    });
  }

  updateCustomer(id: string, dto: Partial<CustomerDto>) {
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  // ── Leads ──

  async listLeads(q: z.infer<typeof leadQuerySchema>) {
    const where: Prisma.LeadWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.search && { OR: [{ name: contains(q.search) }, { company: contains(q.search) }, { email: contains(q.search) }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { owner: { select: { id: true, name: true } }, customer: customerBrief },
        orderBy: { updatedAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.lead.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async pipeline() {
    const rows = await this.prisma.lead.groupBy({ by: ['status'], _count: { _all: true }, _sum: { estimatedValue: true } });
    return rows.map((r) => ({ status: r.status, count: r._count._all, value: D(r._sum.estimatedValue) }));
  }

  createLead(user: AuthUser, dto: LeadDto) {
    return this.prisma.lead.create({ data: { ...dto, ownerId: dto.ownerId ?? user.sub } });
  }

  updateLead(id: string, dto: Partial<LeadDto>) {
    return this.prisma.lead.update({ where: { id }, data: dto });
  }

  convertLead(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUniqueOrThrow({ where: { id } });
      if (lead.customerId) throw new BadRequestException('Lead is already converted');
      const customer = await tx.customer.create({
        data: {
          code: await this.seq.next(tx, 'CUST'),
          name: lead.company || lead.name,
          email: lead.email,
          phone: lead.phone,
        },
      });
      await tx.lead.update({ where: { id }, data: { status: 'WON', customerId: customer.id } });
      await this.audit.log(user.sub, 'convert', 'Lead', id, { customerId: customer.id }, tx);
      return customer;
    });
  }

  // ── Quotations ──

  async listQuotations(q: z.infer<typeof quotationQuerySchema>) {
    const where: Prisma.QuotationWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.search && { OR: [{ number: contains(q.search) }, { customer: { name: contains(q.search) } }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.quotation.findMany({ where, include: { customer: customerBrief }, orderBy: [{ date: 'desc' }, { number: 'desc' }], ...pageArgs(q) }),
      this.prisma.quotation.count({ where }),
    ]);
    return paged(items, total, q);
  }

  getQuotation(id: string) {
    return this.prisma.quotation.findUniqueOrThrow({
      where: { id },
      include: { customer: true, lines: { include: { product: productBrief } }, salesOrders: { select: { id: true, number: true, status: true } } },
    });
  }

  saveQuotation(user: AuthUser, dto: QuotationDto, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { rows, totals } = await this.priceLines(tx, dto.lines);
      const lines = rows.map((r) => ({ ...r, productId: r.productId! }));
      const header = { customerId: dto.customerId, date: dto.date, validUntil: dto.validUntil, notes: dto.notes, ...totals };
      if (!id) {
        const created = await tx.quotation.create({ data: { number: await this.seq.next(tx, 'QT'), ...header, lines: { create: lines } } });
        await this.audit.log(user.sub, 'create', 'Quotation', created.id, undefined, tx);
        return created;
      }
      const current = await tx.quotation.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'DRAFT' && current.status !== 'SENT') throw new BadRequestException('This quotation can no longer be edited');
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({ where: { id }, data: { ...header, lines: { create: lines } } });
    });
  }

  async setQuotationStatus(user: AuthUser, id: string, status: 'SENT' | 'ACCEPTED' | 'REJECTED') {
    const q = await this.prisma.quotation.findUniqueOrThrow({ where: { id } });
    const allowed: Record<typeof status, QuotationStatus[]> = { SENT: ['DRAFT'], ACCEPTED: ['DRAFT', 'SENT'], REJECTED: ['DRAFT', 'SENT'] };
    if (!allowed[status].includes(q.status)) throw new BadRequestException(`Cannot mark a ${q.status} quotation as ${status}`);
    const updated = await this.prisma.quotation.update({ where: { id }, data: { status } });
    await this.audit.log(user.sub, status.toLowerCase(), 'Quotation', id);
    return updated;
  }

  convertQuotation(user: AuthUser, id: string, warehouseId: string) {
    return this.prisma.$transaction(async (tx) => {
      const q = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (q.status === 'CONVERTED' || q.status === 'REJECTED') throw new BadRequestException(`Quotation is ${q.status.toLowerCase()}`);
      const order = await tx.salesOrder.create({
        data: {
          number: await this.seq.next(tx, 'SO'),
          customerId: q.customerId,
          quotationId: q.id,
          warehouseId,
          date: new Date(),
          notes: q.notes,
          subtotal: q.subtotal,
          taxTotal: q.taxTotal,
          total: q.total,
          lines: {
            create: q.lines.map((l) => ({
              productId: l.productId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              taxRate: l.taxRate,
              lineTotal: l.lineTotal,
              taxAmount: l.taxAmount,
            })),
          },
        },
      });
      await tx.quotation.update({ where: { id }, data: { status: 'CONVERTED' } });
      await this.audit.log(user.sub, 'convert', 'Quotation', id, { salesOrderId: order.id }, tx);
      return order;
    });
  }

  // ── Sales orders ──

  async listOrders(q: z.infer<typeof orderQuerySchema>) {
    const where: Prisma.SalesOrderWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.search && { OR: [{ number: contains(q.search) }, { customer: { name: contains(q.search) } }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: { customer: customerBrief, warehouse: { select: { code: true } } },
        orderBy: [{ date: 'desc' }, { number: 'desc' }],
        ...pageArgs(q),
      }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return paged(items, total, q);
  }

  getOrder(id: string) {
    return this.prisma.salesOrder.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        quotation: { select: { id: true, number: true } },
        lines: { include: { product: productBrief } },
        invoices: { select: { id: true, number: true, status: true, total: true } },
      },
    });
  }

  saveOrder(user: AuthUser, dto: OrderDto, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { rows, totals } = await this.priceLines(tx, dto.lines);
      const lines = rows.map((r) => ({ ...r, productId: r.productId! }));
      const header = { customerId: dto.customerId, warehouseId: dto.warehouseId, date: dto.date, notes: dto.notes, ...totals };
      if (!id) {
        const created = await tx.salesOrder.create({ data: { number: await this.seq.next(tx, 'SO'), ...header, lines: { create: lines } } });
        await this.audit.log(user.sub, 'create', 'SalesOrder', created.id, undefined, tx);
        return created;
      }
      const current = await tx.salesOrder.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'DRAFT') throw new BadRequestException('Only draft orders can be edited');
      await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
      return tx.salesOrder.update({ where: { id }, data: { ...header, lines: { create: lines } } });
    });
  }

  confirmOrder(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { customer: true } });
      if (so.status !== 'DRAFT') throw new BadRequestException('Only drafts can be confirmed');
      const limit = D(so.customer.creditLimit);
      if (limit.gt(0)) {
        const openOrders = await tx.salesOrder.aggregate({
          where: { customerId: so.customerId, status: { in: ['CONFIRMED', 'PARTIALLY_DELIVERED'] } },
          _sum: { total: true },
        });
        const exposure = (await this.outstanding(tx, so.customerId)).plus(D(openOrders._sum.total)).plus(so.total);
        if (exposure.gt(limit)) {
          throw new BadRequestException(`Credit limit exceeded: exposure ${exposure.toFixed(2)} > limit ${limit.toFixed(2)}`);
        }
      }
      await this.audit.log(user.sub, 'confirm', 'SalesOrder', id, undefined, tx);
      return tx.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED' } });
    });
  }

  async cancelOrder(user: AuthUser, id: string) {
    const so = await this.prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    if (so.status !== 'DRAFT' && so.status !== 'CONFIRMED') throw new BadRequestException('This order can no longer be cancelled');
    if (so.lines.some((l) => D(l.deliveredQty).gt(0))) throw new BadRequestException('Goods have already been delivered');
    const updated = await this.prisma.salesOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(user.sub, 'cancel', 'SalesOrder', id);
    return updated;
  }

  deliver(user: AuthUser, id: string, dto: DeliverDto) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { lines: { include: { product: true } } } });
      if (so.status !== 'CONFIRMED' && so.status !== 'PARTIALLY_DELIVERED') throw new BadRequestException('Only confirmed orders can be delivered');
      const date = dto.date ?? new Date();
      const requests =
        dto.lines ??
        so.lines.map((l) => ({ lineId: l.id, quantity: D(l.quantity).minus(l.deliveredQty) })).filter((r) => r.quantity.gt(0));
      if (!requests.length) throw new BadRequestException('Nothing left to deliver');

      let cost = ZERO;
      for (const r of requests) {
        const line = so.lines.find((l) => l.id === r.lineId);
        if (!line) throw new BadRequestException('Line does not belong to this order');
        const qty = D(r.quantity);
        const remaining = D(line.quantity).minus(line.deliveredQty);
        if (qty.gt(remaining)) throw new BadRequestException(`Cannot deliver more than the remaining ${remaining} of ${line.product.sku}`);
        const res = await this.stock.issue(tx, {
          type: 'DELIVERY',
          productId: line.productId,
          warehouseId: so.warehouseId,
          quantity: qty,
          date,
          reference: so.number,
          sourceType: 'SalesOrder',
          sourceId: so.id,
        });
        cost = cost.plus(res.value);
        await tx.salesOrderLine.update({ where: { id: line.id }, data: { deliveredQty: { increment: qty } } });
        line.deliveredQty = D(line.deliveredQty).plus(qty);
      }

      if (cost.gt(0)) {
        await this.ledger.post(tx, {
          date,
          description: `Cost of goods delivered for ${so.number}`,
          reference: so.number,
          sourceType: 'STOCK',
          sourceId: so.id,
          lines: [
            { key: 'COST_OF_GOODS_SOLD', debit: cost },
            { key: 'INVENTORY', credit: cost },
          ],
        });
      }
      const complete = so.lines.every((l) => D(l.deliveredQty).gte(l.quantity));
      await this.audit.log(user.sub, 'deliver', 'SalesOrder', id, requests, tx);
      return tx.salesOrder.update({ where: { id }, data: { status: complete ? 'DELIVERED' : 'PARTIALLY_DELIVERED' } });
    });
  }

  invoiceFromOrder(user: AuthUser, id: string, invoiceDate?: Date) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { customer: true, lines: { include: { product: true } } } });
      if (so.status === 'DRAFT' || so.status === 'CANCELLED') throw new BadRequestException('Confirm the order before invoicing');
      const lines = so.lines
        .map((l) => ({ l, qty: (l.product.trackInventory ? D(l.deliveredQty) : D(l.quantity)).minus(l.invoicedQty) }))
        .filter(({ qty }) => qty.gt(0))
        .map(({ l, qty }) => {
          const base = { quantity: qty, unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate };
          return { productId: l.productId, description: l.description ?? l.product.name, ...base, ...computeLine(base) };
        });
      if (!lines.length) throw new BadRequestException('Nothing to invoice: deliver goods first');
      const date = invoiceDate ?? new Date();
      const invoice = await tx.salesInvoice.create({
        data: {
          number: await this.seq.next(tx, 'INV'),
          customerId: so.customerId,
          salesOrderId: so.id,
          date,
          dueDate: addDays(date, so.customer.paymentTermsDays),
          ...sumTotals(lines),
          lines: { create: lines },
        },
      });
      await this.audit.log(user.sub, 'create', 'SalesInvoice', invoice.id, { fromOrder: so.number }, tx);
      return invoice;
    });
  }

  // ── Invoices ──

  async listInvoices(q: z.infer<typeof invoiceQuerySchema>) {
    const where: Prisma.SalesInvoiceWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.search && { OR: [{ number: contains(q.search) }, { customer: { name: contains(q.search) } }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({ where, include: { customer: customerBrief }, orderBy: [{ date: 'desc' }, { number: 'desc' }], ...pageArgs(q) }),
      this.prisma.salesInvoice.count({ where }),
    ]);
    return paged(items, total, q);
  }

  getInvoice(id: string) {
    return this.prisma.salesInvoice.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        salesOrder: { select: { id: true, number: true } },
        lines: { include: { product: productBrief } },
        payments: { orderBy: { date: 'asc' } },
      },
    });
  }

  saveInvoice(user: AuthUser, dto: InvoiceDto, id?: string) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: dto.customerId } });
      const { rows, totals, hasTracked } = await this.priceLines(tx, dto.lines);
      const header = {
        customerId: dto.customerId,
        date: dto.date,
        dueDate: dto.dueDate ?? addDays(dto.date, customer.paymentTermsDays),
        notes: dto.notes,
        ...totals,
      };
      if (!id) {
        if (hasTracked) throw new BadRequestException('Stock-tracked products must be invoiced from a sales order');
        const created = await tx.salesInvoice.create({ data: { number: await this.seq.next(tx, 'INV'), ...header, lines: { create: rows } } });
        await this.audit.log(user.sub, 'create', 'SalesInvoice', created.id, undefined, tx);
        return created;
      }
      const current = await tx.salesInvoice.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'DRAFT') throw new BadRequestException('Only draft invoices can be edited');
      if (hasTracked && !current.salesOrderId) throw new BadRequestException('Stock-tracked products must be invoiced from a sales order');
      if (current.salesOrderId && current.customerId !== dto.customerId) throw new BadRequestException('Customer cannot change on an order invoice');
      await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
      return tx.salesInvoice.update({ where: { id }, data: { ...header, lines: { create: rows } } });
    });
  }

  postInvoice(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id }, include: { lines: { include: { product: true } } } });
      if (inv.status !== 'DRAFT') throw new BadRequestException('Only draft invoices can be posted');

      if (inv.salesOrderId) {
        const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: inv.salesOrderId }, include: { lines: { include: { product: true } } } });
        const used = new Map<string, Decimal>();
        for (const l of inv.lines) {
          if (!l.productId) continue;
          const alloc = allocate(
            so.lines,
            l.productId,
            D(l.quantity),
            (sl) => (sl.product.trackInventory ? D(sl.deliveredQty) : D(sl.quantity)).minus(sl.invoicedQty),
            used,
          );
          if (!alloc) {
            throw new BadRequestException(`Cannot invoice more ${l.description} than was ${l.product?.trackInventory ? 'delivered' : 'ordered'}`);
          }
          for (const a of alloc) {
            await tx.salesOrderLine.update({ where: { id: a.line.id }, data: { invoicedQty: { increment: a.qty } } });
          }
        }
      } else if (inv.lines.some((l) => l.product?.trackInventory)) {
        throw new BadRequestException('Stock-tracked products must be invoiced from a sales order');
      }

      const entry = await this.ledger.post(tx, {
        date: inv.date,
        description: `Sales invoice ${inv.number}`,
        reference: inv.number,
        sourceType: 'SALES_INVOICE',
        sourceId: inv.id,
        lines: [
          { key: 'ACCOUNTS_RECEIVABLE', debit: inv.total },
          { key: 'SALES_REVENUE', credit: inv.subtotal },
          { key: 'TAX_PAYABLE', credit: inv.taxTotal },
        ],
      });
      await this.audit.log(user.sub, 'post', 'SalesInvoice', id, undefined, tx);
      return tx.salesInvoice.update({ where: { id }, data: { status: 'POSTED', journalEntryId: entry.id } });
    });
  }

  voidInvoice(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (inv.status === 'DRAFT') {
        await tx.salesInvoice.delete({ where: { id } });
        return { deleted: true };
      }
      if (inv.status !== 'POSTED') throw new BadRequestException('Only unpaid posted invoices can be voided');
      await this.ledger.assertOpenPeriod(tx, inv.date);
      if (inv.salesOrderId) {
        const so = await tx.salesOrder.findUniqueOrThrow({ where: { id: inv.salesOrderId }, include: { lines: true } });
        const used = new Map<string, Decimal>();
        for (const l of inv.lines.filter((x) => x.productId)) {
          for (const a of allocate(so.lines, l.productId!, D(l.quantity), (sl) => D(sl.invoicedQty), used) ?? []) {
            await tx.salesOrderLine.update({ where: { id: a.line.id }, data: { invoicedQty: { decrement: a.qty } } });
          }
        }
      }
      if (inv.journalEntryId) await tx.journalEntry.update({ where: { id: inv.journalEntryId }, data: { status: 'VOID' } });
      await this.audit.log(user.sub, 'void', 'SalesInvoice', id, undefined, tx);
      return tx.salesInvoice.update({ where: { id }, data: { status: 'VOID' } });
    });
  }

  // ── PDFs ──

  async invoicePdf(id: string) {
    const inv = await this.getInvoice(id);
    const buffer = await this.pdf.render((f) => ({
      title: 'Invoice',
      number: inv.number,
      status: inv.status === 'DRAFT' ? 'Draft' : undefined,
      party: { label: 'Bill to', name: inv.customer.name, lines: [inv.customer.address, inv.customer.email, inv.customer.taxNumber && `Tax no. ${inv.customer.taxNumber}`] },
      meta: [
        ['Invoice date', f.date(inv.date)],
        ['Due date', f.date(inv.dueDate)],
        ...(inv.salesOrder ? [['Sales order', inv.salesOrder.number] as [string, string]] : []),
        ['Balance due', f.money(D(inv.total).minus(inv.amountPaid))],
      ],
      ...linesTable(inv.lines, f),
      totals: [
        ['Subtotal', f.money(inv.subtotal)],
        ['Tax', f.money(inv.taxTotal)],
        ['Total', f.money(inv.total), true],
        ...(D(inv.amountPaid).gt(0)
          ? ([
              ['Paid', f.money(inv.amountPaid)],
              ['Balance due', f.money(D(inv.total).minus(inv.amountPaid)), true],
            ] as [string, string, boolean?][])
          : []),
      ],
      notes: inv.notes,
    }));
    return { buffer, filename: `${inv.number}.pdf` };
  }

  async quotationPdf(id: string) {
    const q = await this.getQuotation(id);
    const buffer = await this.pdf.render((f) => ({
      title: 'Quotation',
      number: q.number,
      party: { label: 'Prepared for', name: q.customer.name, lines: [q.customer.address, q.customer.email] },
      meta: [
        ['Date', f.date(q.date)],
        ['Valid until', f.date(q.validUntil)],
      ],
      ...linesTable(q.lines, f),
      totals: [
        ['Subtotal', f.money(q.subtotal)],
        ['Tax', f.money(q.taxTotal)],
        ['Total', f.money(q.total), true],
      ],
      notes: q.notes,
    }));
    return { buffer, filename: `${q.number}.pdf` };
  }
}

type Q<T extends z.ZodTypeAny> = z.infer<T>;

@Roles(Role.SALES, Role.ACCOUNTANT)
@Controller('sales')
export class SalesController {
  constructor(private readonly svc: SalesService) {}

  @Get('customers')
  listCustomers(@Query(new ZodPipe(listQuerySchema)) q: Q<typeof listQuerySchema>) {
    return this.svc.listCustomers(q);
  }

  @Get('customers/:id')
  getCustomer(@Param('id') id: string) {
    return this.svc.getCustomer(id);
  }

  @Post('customers')
  createCustomer(@CurrentUser() u: AuthUser, @Body(new ZodPipe(customerSchema)) dto: CustomerDto) {
    return this.svc.createCustomer(u, dto);
  }

  @Patch('customers/:id')
  updateCustomer(@Param('id') id: string, @Body(new ZodPipe(customerSchema.partial())) dto: Partial<CustomerDto>) {
    return this.svc.updateCustomer(id, dto);
  }

  @Roles(Role.SALES)
  @Get('leads')
  listLeads(@Query(new ZodPipe(leadQuerySchema)) q: Q<typeof leadQuerySchema>) {
    return this.svc.listLeads(q);
  }

  @Roles(Role.SALES)
  @Get('leads/pipeline')
  pipeline() {
    return this.svc.pipeline();
  }

  @Roles(Role.SALES)
  @Post('leads')
  createLead(@CurrentUser() u: AuthUser, @Body(new ZodPipe(leadSchema)) dto: LeadDto) {
    return this.svc.createLead(u, dto);
  }

  @Roles(Role.SALES)
  @Patch('leads/:id')
  updateLead(@Param('id') id: string, @Body(new ZodPipe(leadSchema.partial())) dto: Partial<LeadDto>) {
    return this.svc.updateLead(id, dto);
  }

  @Roles(Role.SALES)
  @Post('leads/:id/convert')
  convertLead(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.convertLead(u, id);
  }

  @Get('quotations')
  listQuotations(@Query(new ZodPipe(quotationQuerySchema)) q: Q<typeof quotationQuerySchema>) {
    return this.svc.listQuotations(q);
  }

  @Get('quotations/:id')
  getQuotation(@Param('id') id: string) {
    return this.svc.getQuotation(id);
  }

  @Roles(Role.SALES)
  @Post('quotations')
  createQuotation(@CurrentUser() u: AuthUser, @Body(new ZodPipe(quotationSchema)) dto: QuotationDto) {
    return this.svc.saveQuotation(u, dto);
  }

  @Roles(Role.SALES)
  @Put('quotations/:id')
  updateQuotation(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(quotationSchema)) dto: QuotationDto) {
    return this.svc.saveQuotation(u, dto, id);
  }

  @Roles(Role.SALES)
  @Post('quotations/:id/send')
  sendQuotation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setQuotationStatus(u, id, 'SENT');
  }

  @Roles(Role.SALES)
  @Post('quotations/:id/accept')
  acceptQuotation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setQuotationStatus(u, id, 'ACCEPTED');
  }

  @Roles(Role.SALES)
  @Post('quotations/:id/reject')
  rejectQuotation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.setQuotationStatus(u, id, 'REJECTED');
  }

  @Roles(Role.SALES)
  @Post('quotations/:id/convert')
  convertQuotation(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ warehouseId: zId }))) body: { warehouseId: string }) {
    return this.svc.convertQuotation(u, id, body.warehouseId);
  }

  @Get('orders')
  listOrders(@Query(new ZodPipe(orderQuerySchema)) q: Q<typeof orderQuerySchema>) {
    return this.svc.listOrders(q);
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.svc.getOrder(id);
  }

  @Roles(Role.SALES)
  @Post('orders')
  createOrder(@CurrentUser() u: AuthUser, @Body(new ZodPipe(orderSchema)) dto: OrderDto) {
    return this.svc.saveOrder(u, dto);
  }

  @Roles(Role.SALES)
  @Put('orders/:id')
  updateOrder(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orderSchema)) dto: OrderDto) {
    return this.svc.saveOrder(u, dto, id);
  }

  @Roles(Role.SALES)
  @Post('orders/:id/confirm')
  confirmOrder(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.confirmOrder(u, id);
  }

  @Roles(Role.SALES)
  @Post('orders/:id/cancel')
  cancelOrder(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.cancelOrder(u, id);
  }

  @Roles(Role.SALES, Role.INVENTORY)
  @Post('orders/:id/deliver')
  deliver(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(deliverSchema)) dto: DeliverDto) {
    return this.svc.deliver(u, id, dto);
  }

  @Post('orders/:id/invoice')
  invoiceFromOrder(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ date: zDate.optional() }))) body: { date?: Date }) {
    return this.svc.invoiceFromOrder(u, id, body.date);
  }

  @Get('invoices')
  listInvoices(@Query(new ZodPipe(invoiceQuerySchema)) q: Q<typeof invoiceQuerySchema>) {
    return this.svc.listInvoices(q);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string) {
    return this.svc.getInvoice(id);
  }

  @Get('invoices/:id/pdf')
  async invoicePdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.svc.invoicePdf(id);
    return pdfResponse(res, buffer, filename);
  }

  @Get('quotations/:id/pdf')
  async quotationPdf(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.svc.quotationPdf(id);
    return pdfResponse(res, buffer, filename);
  }

  @Post('invoices')
  createInvoice(@CurrentUser() u: AuthUser, @Body(new ZodPipe(invoiceSchema)) dto: InvoiceDto) {
    return this.svc.saveInvoice(u, dto);
  }

  @Put('invoices/:id')
  updateInvoice(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(invoiceSchema)) dto: InvoiceDto) {
    return this.svc.saveInvoice(u, dto, id);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('invoices/:id/post')
  postInvoice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.postInvoice(u, id);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('invoices/:id/void')
  voidInvoice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.voidInvoice(u, id);
  }
}

@Module({
  imports: [AccountingModule, InventoryModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
