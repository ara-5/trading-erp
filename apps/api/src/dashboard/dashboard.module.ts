import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { naturalBalance } from '../accounting/ledger.service';
import { D } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    const billed = { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] as ('POSTED' | 'PARTIALLY_PAID' | 'PAID')[] };
    const open = { in: ['POSTED', 'PARTIALLY_PAID'] as ('POSTED' | 'PARTIALLY_PAID')[] };

    const [salesMonth, receivables, payables, cashAccounts, lowStock, openOrders, openPOs, headcount, pendingLeave, salesTrend, purchaseTrend, topProducts, recentInvoices] =
      await Promise.all([
        this.prisma.salesInvoice.aggregate({ where: { status: billed, date: { gte: monthStart } }, _sum: { subtotal: true }, _count: true }),
        this.prisma.salesInvoice.aggregate({ where: { status: open }, _sum: { total: true, amountPaid: true } }),
        this.prisma.purchaseBill.aggregate({ where: { status: open }, _sum: { total: true, amountPaid: true } }),
        this.prisma.systemAccount.findMany({ where: { key: { in: ['CASH', 'BANK'] } }, select: { accountId: true } }),
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT p.id FROM "Product" p LEFT JOIN "StockLevel" s ON s."productId" = p.id
            WHERE p."isActive" AND p."trackInventory" AND p."reorderLevel" > 0
            GROUP BY p.id HAVING COALESCE(SUM(s.quantity), 0) <= p."reorderLevel"
          ) t`,
        this.prisma.salesOrder.count({ where: { status: { in: ['CONFIRMED', 'PARTIALLY_DELIVERED'] } } }),
        this.prisma.purchaseOrder.count({ where: { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } } }),
        this.prisma.employee.count({ where: { status: { not: 'TERMINATED' } } }),
        this.prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
        this.prisma.$queryRaw<{ month: string; amount: number }[]>`
          SELECT to_char(date_trunc('month', "date"), 'YYYY-MM') AS month, SUM("subtotal")::float AS amount
          FROM "SalesInvoice" WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND "date" >= ${trendStart}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<{ month: string; amount: number }[]>`
          SELECT to_char(date_trunc('month', "date"), 'YYYY-MM') AS month, SUM("subtotal")::float AS amount
          FROM "PurchaseBill" WHERE status IN ('POSTED', 'PARTIALLY_PAID', 'PAID') AND "date" >= ${trendStart}
          GROUP BY 1 ORDER BY 1`,
        this.prisma.salesInvoiceLine.groupBy({
          by: ['productId'],
          where: { productId: { not: null }, invoice: { status: billed, date: { gte: ninetyDaysAgo } } },
          _sum: { lineTotal: true, quantity: true },
          orderBy: { _sum: { lineTotal: 'desc' } },
          take: 5,
        }),
        this.prisma.salesInvoice.findMany({
          where: { status: { not: 'VOID' } },
          include: { customer: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 6,
        }),
      ]);

    const cashIds = cashAccounts.map((c) => c.accountId);
    const cashAgg = cashIds.length
      ? await this.prisma.journalLine.aggregate({ where: { accountId: { in: cashIds }, entry: { status: 'POSTED' } }, _sum: { debit: true, credit: true } })
      : { _sum: { debit: null, credit: null } };

    const products = await this.prisma.product.findMany({
      where: { id: { in: topProducts.map((t) => t.productId!) } },
      select: { id: true, sku: true, name: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    // Fill empty months so the chart has a continuous 6-month axis.
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1));
      return d.toISOString().slice(0, 7);
    });
    const trend = months.map((month) => ({
      month,
      sales: salesTrend.find((r) => r.month === month)?.amount ?? 0,
      purchases: purchaseTrend.find((r) => r.month === month)?.amount ?? 0,
    }));

    return {
      kpis: {
        salesThisMonth: D(salesMonth._sum.subtotal),
        invoicesThisMonth: salesMonth._count,
        receivables: D(receivables._sum.total).minus(D(receivables._sum.amountPaid)),
        payables: D(payables._sum.total).minus(D(payables._sum.amountPaid)),
        cash: naturalBalance('ASSET', D(cashAgg._sum.debit), D(cashAgg._sum.credit)),
        lowStock: Number(lowStock[0]?.count ?? 0),
        openSalesOrders: openOrders,
        openPurchaseOrders: openPOs,
        headcount,
        pendingLeave,
      },
      trend,
      topProducts: topProducts.map((t) => ({
        product: productById.get(t.productId!),
        revenue: D(t._sum.lineTotal),
        quantity: D(t._sum.quantity),
      })),
      recentInvoices,
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  summary() {
    return this.svc.summary();
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
