import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { AccountingModule } from '../accounting/accounting.module';
import { LedgerService } from '../accounting/ledger.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService } from '../common/common.module';
import { D } from '../common/money';
import { contains, listQuerySchema, pageArgs, paged, zDate, zId, zMoney, zOptStr, zQty, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

const productSchema = z.object({
  sku: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  description: zOptStr,
  uom: z.string().trim().min(1).max(20).default('pcs'),
  categoryId: z.string().min(1).nullish(),
  trackInventory: z.boolean().default(true),
  salePrice: zMoney.default(0),
  costPrice: zMoney.optional(),
  taxRateId: z.string().min(1).nullish(),
  reorderLevel: z.coerce.number().min(0).default(0),
  isActive: z.boolean().optional(),
});
type ProductDto = z.infer<typeof productSchema>;
const productUpdateSchema = productSchema.omit({ costPrice: true, trackInventory: true }).partial();

const productQuerySchema = listQuerySchema.extend({ categoryId: z.string().optional() });
type ProductQuery = z.infer<typeof productQuerySchema>;

const warehouseSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1),
  address: zOptStr,
  isActive: z.boolean().optional(),
});
type WarehouseDto = z.infer<typeof warehouseSchema>;

const categorySchema = z.object({ name: z.string().trim().min(1).max(100) });

const adjustSchema = z.object({
  productId: zId,
  warehouseId: zId,
  quantity: z.coerce.number().refine((n) => n !== 0, 'Quantity cannot be zero'),
  unitCost: zMoney.optional(),
  date: zDate.optional(),
  reason: z.string().trim().min(1),
});
type AdjustDto = z.infer<typeof adjustSchema>;

const transferSchema = z
  .object({ productId: zId, fromWarehouseId: zId, toWarehouseId: zId, quantity: zQty, date: zDate.optional(), reference: zOptStr })
  .refine((t) => t.fromWarehouseId !== t.toWarehouseId, { message: 'Source and destination must differ', path: ['toWarehouseId'] });
type TransferDto = z.infer<typeof transferSchema>;

const stockQuerySchema = listQuerySchema.extend({ warehouseId: z.string().optional(), productId: z.string().optional() });
type StockQuery = z.infer<typeof stockQuerySchema>;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async listProducts(q: ProductQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(q.status === 'all' ? {} : { isActive: q.status !== 'inactive' }),
      ...(q.search && { OR: [{ sku: contains(q.search) }, { name: contains(q.search) }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: { select: { id: true, name: true } }, taxRate: { select: { id: true, name: true, rate: true } } },
        orderBy: { name: 'asc' },
        ...pageArgs(q),
      }),
      this.prisma.product.count({ where }),
    ]);
    const sums = await this.prisma.stockLevel.groupBy({
      by: ['productId'],
      where: { productId: { in: items.map((p) => p.id) } },
      _sum: { quantity: true },
    });
    const onHand = new Map(sums.map((s) => [s.productId, D(s._sum.quantity)]));
    return paged(
      items.map((p) => ({ ...p, onHand: onHand.get(p.id) ?? D(0) })),
      total,
      q,
    );
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: {
        category: true,
        taxRate: true,
        stockLevels: { include: { warehouse: { select: { id: true, code: true, name: true } } } },
        movements: { take: 50, orderBy: { date: 'desc' }, include: { warehouse: { select: { code: true } } } },
      },
    });
    const onHand = product.stockLevels.reduce((s, l) => s.plus(l.quantity), D(0));
    return { ...product, onHand, stockValue: onHand.mul(product.costPrice).toDecimalPlaces(2) };
  }

  async createProduct(user: AuthUser, dto: ProductDto) {
    const product = await this.prisma.product.create({ data: dto });
    await this.audit.log(user.sub, 'create', 'Product', product.id, dto);
    return product;
  }

  async updateProduct(user: AuthUser, id: string, dto: z.infer<typeof productUpdateSchema>) {
    const product = await this.prisma.product.update({ where: { id }, data: dto });
    await this.audit.log(user.sub, 'update', 'Product', id, dto);
    return product;
  }

  lowStock() {
    return this.prisma.$queryRaw<{ id: string; sku: string; name: string; uom: string; reorderLevel: string; onHand: string }[]>`
      SELECT p.id, p.sku, p.name, p.uom, p."reorderLevel", COALESCE(SUM(s.quantity), 0) AS "onHand"
      FROM "Product" p
      LEFT JOIN "StockLevel" s ON s."productId" = p.id
      WHERE p."isActive" AND p."trackInventory" AND p."reorderLevel" > 0
      GROUP BY p.id
      HAVING COALESCE(SUM(s.quantity), 0) <= p."reorderLevel"
      ORDER BY p.name`;
  }

  async stockLevels(q: StockQuery) {
    const where: Prisma.StockLevelWhereInput = {
      quantity: { not: 0 },
      ...(q.warehouseId && { warehouseId: q.warehouseId }),
      ...(q.productId && { productId: q.productId }),
      ...(q.search && { product: { OR: [{ sku: contains(q.search) }, { name: contains(q.search) }] } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true, costPrice: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ product: { name: 'asc' } }],
        ...pageArgs(q),
      }),
      this.prisma.stockLevel.count({ where }),
    ]);
    const items = rows.map((r) => ({ ...r, value: D(r.quantity).mul(r.product.costPrice).toDecimalPlaces(2) }));
    return paged(items, total, q);
  }

  async stockValuation() {
    const rows = await this.prisma.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(s.quantity * p."costPrice") AS total
      FROM "StockLevel" s JOIN "Product" p ON p.id = s."productId"`;
    return { total: D(rows[0]?.total).toDecimalPlaces(2) };
  }

  async movements(q: StockQuery) {
    const where: Prisma.StockMovementWhereInput = {
      ...(q.warehouseId && { warehouseId: q.warehouseId }),
      ...(q.productId && { productId: q.productId }),
      ...(q.search && { OR: [{ reference: contains(q.search) }, { product: { sku: contains(q.search) } }] }),
    };
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          warehouse: { select: { id: true, code: true } },
        },
        orderBy: { date: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return paged(items, total, q);
  }

  adjust(user: AuthUser, dto: AdjustDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: dto.productId } });
      if (!product.trackInventory) throw new BadRequestException('Product does not track inventory');
      const date = dto.date ?? new Date();
      const base = {
        type: 'ADJUSTMENT' as const,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: Math.abs(dto.quantity),
        date,
        reference: dto.reason,
        sourceType: 'Adjustment',
      };
      const increase = dto.quantity > 0;
      const { value } = increase
        ? await this.stock.receive(tx, { ...base, unitCost: dto.unitCost ?? D(product.costPrice) })
        : await this.stock.issue(tx, base);

      if (value.gt(0)) {
        await this.ledger.post(tx, {
          date,
          description: `Stock adjustment ${product.sku}: ${dto.reason}`,
          reference: product.sku,
          sourceType: 'STOCK',
          sourceId: product.id,
          lines: increase
            ? [{ key: 'INVENTORY', debit: value }, { key: 'INVENTORY_ADJUSTMENT', credit: value }]
            : [{ key: 'INVENTORY_ADJUSTMENT', debit: value }, { key: 'INVENTORY', credit: value }],
        });
      }
      await this.audit.log(user.sub, 'adjust', 'Stock', product.id, dto, tx);
      return { ok: true, value };
    });
  }

  transfer(user: AuthUser, dto: TransferDto) {
    return this.prisma.$transaction(async (tx) => {
      const common = { productId: dto.productId, quantity: dto.quantity, date: dto.date ?? new Date(), reference: dto.reference ?? 'Transfer', sourceType: 'Transfer' };
      const out = await this.stock.issue(tx, { ...common, type: 'TRANSFER_OUT', warehouseId: dto.fromWarehouseId });
      if (!out.tracked) throw new BadRequestException('Product does not track inventory');
      await this.stock.receive(tx, { ...common, type: 'TRANSFER_IN', warehouseId: dto.toWarehouseId, unitCost: out.unitCost });
      await this.audit.log(user.sub, 'transfer', 'Stock', dto.productId, dto, tx);
      return { ok: true };
    });
  }
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly svc: InventoryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('products')
  listProducts(@Query(new ZodPipe(productQuerySchema)) q: ProductQuery) {
    return this.svc.listProducts(q);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.svc.getProduct(id);
  }

  @Roles(Role.INVENTORY, Role.PURCHASING)
  @Post('products')
  createProduct(@CurrentUser() u: AuthUser, @Body(new ZodPipe(productSchema)) dto: ProductDto) {
    return this.svc.createProduct(u, dto);
  }

  @Roles(Role.INVENTORY, Role.PURCHASING)
  @Patch('products/:id')
  updateProduct(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(productUpdateSchema)) dto: z.infer<typeof productUpdateSchema>) {
    return this.svc.updateProduct(u, id, dto);
  }

  @Get('categories')
  listCategories() {
    return this.prisma.productCategory.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: true } } } });
  }

  @Roles(Role.INVENTORY)
  @Post('categories')
  createCategory(@Body(new ZodPipe(categorySchema)) dto: z.infer<typeof categorySchema>) {
    return this.prisma.productCategory.create({ data: dto });
  }

  @Roles(Role.INVENTORY)
  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body(new ZodPipe(categorySchema)) dto: z.infer<typeof categorySchema>) {
    return this.prisma.productCategory.update({ where: { id }, data: dto });
  }

  @Roles(Role.INVENTORY)
  @Delete('categories/:id')
  async removeCategory(@Param('id') id: string) {
    await this.prisma.productCategory.delete({ where: { id } });
    return { ok: true };
  }

  @Get('warehouses')
  listWarehouses() {
    return this.prisma.warehouse.findMany({ orderBy: { code: 'asc' } });
  }

  @Roles(Role.INVENTORY)
  @Post('warehouses')
  createWarehouse(@Body(new ZodPipe(warehouseSchema)) dto: WarehouseDto) {
    return this.prisma.warehouse.create({ data: dto });
  }

  @Roles(Role.INVENTORY)
  @Patch('warehouses/:id')
  updateWarehouse(@Param('id') id: string, @Body(new ZodPipe(warehouseSchema.partial())) dto: Partial<WarehouseDto>) {
    return this.prisma.warehouse.update({ where: { id }, data: dto });
  }

  @Get('stock')
  stockLevels(@Query(new ZodPipe(stockQuerySchema)) q: StockQuery) {
    return this.svc.stockLevels(q);
  }

  @Get('stock/low')
  lowStock() {
    return this.svc.lowStock();
  }

  @Get('stock/valuation')
  valuation() {
    return this.svc.stockValuation();
  }

  @Get('movements')
  movements(@Query(new ZodPipe(stockQuerySchema)) q: StockQuery) {
    return this.svc.movements(q);
  }

  @Roles(Role.INVENTORY)
  @Post('stock/adjust')
  adjust(@CurrentUser() u: AuthUser, @Body(new ZodPipe(adjustSchema)) dto: AdjustDto) {
    return this.svc.adjust(u, dto);
  }

  @Roles(Role.INVENTORY)
  @Post('stock/transfer')
  transfer(@CurrentUser() u: AuthUser, @Body(new ZodPipe(transferSchema)) dto: TransferDto) {
    return this.svc.transfer(u, dto);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockService],
  exports: [StockService],
})
export class InventoryModule {}
