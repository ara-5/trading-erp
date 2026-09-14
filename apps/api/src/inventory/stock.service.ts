import { BadRequestException, Injectable } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { D, Decimal, round2, ZERO } from '../common/money';
import { Tx } from '../prisma/prisma.service';

export interface StockMoveInput {
  type: StockMovementType;
  productId: string;
  warehouseId: string;
  quantity: Decimal | number; // always positive; direction comes from receive/issue
  date?: Date;
  reference?: string;
  sourceType?: string;
  sourceId?: string;
}

/**
 * All physical stock changes flow through this service. It keeps StockLevel, StockMovement and the
 * product's moving weighted-average cost consistent, and returns the value moved so callers can post it.
 */
@Injectable()
export class StockService {
  /** Row-locks the product so concurrent receipts can't corrupt the average cost. */
  private async lockProduct(tx: Tx, productId: string) {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
    return tx.product.findUniqueOrThrow({ where: { id: productId } });
  }

  async receive(tx: Tx, input: StockMoveInput & { unitCost: Decimal | number }) {
    const product = await this.lockProduct(tx, input.productId);
    const qty = D(input.quantity);
    const unitCost = D(input.unitCost);
    if (qty.lte(0)) throw new BadRequestException('Quantity must be positive');
    if (!product.trackInventory) return { tracked: false, value: ZERO };

    const agg = await tx.stockLevel.aggregate({ where: { productId: product.id }, _sum: { quantity: true } });
    const onHand = D(agg._sum.quantity);
    const newQty = onHand.plus(qty);
    const newCost = onHand.lte(0) ? unitCost : onHand.mul(product.costPrice).plus(qty.mul(unitCost)).div(newQty);

    await tx.product.update({ where: { id: product.id }, data: { costPrice: newCost.toDecimalPlaces(4) } });
    await tx.stockLevel.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: input.warehouseId } },
      create: { productId: product.id, warehouseId: input.warehouseId, quantity: qty },
      update: { quantity: { increment: qty } },
    });
    await tx.stockMovement.create({
      data: {
        type: input.type,
        productId: product.id,
        warehouseId: input.warehouseId,
        quantity: qty,
        unitCost,
        date: input.date ?? new Date(),
        reference: input.reference,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    return { tracked: true, value: round2(qty.mul(unitCost)) };
  }

  async issue(tx: Tx, input: StockMoveInput) {
    const product = await this.lockProduct(tx, input.productId);
    const qty = D(input.quantity);
    if (qty.lte(0)) throw new BadRequestException('Quantity must be positive');
    if (!product.trackInventory) return { tracked: false, unitCost: ZERO, value: ZERO };

    const { count } = await tx.stockLevel.updateMany({
      where: { productId: product.id, warehouseId: input.warehouseId, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
    if (count !== 1) {
      const level = await tx.stockLevel.findUnique({
        where: { productId_warehouseId: { productId: product.id, warehouseId: input.warehouseId } },
      });
      throw new BadRequestException(`Insufficient stock for ${product.sku}: available ${D(level?.quantity)}, requested ${qty}`);
    }

    const unitCost = D(product.costPrice);
    await tx.stockMovement.create({
      data: {
        type: input.type,
        productId: product.id,
        warehouseId: input.warehouseId,
        quantity: qty.neg(),
        unitCost,
        date: input.date ?? new Date(),
        reference: input.reference,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    return { tracked: true, unitCost, value: round2(qty.mul(unitCost)) };
  }
}
