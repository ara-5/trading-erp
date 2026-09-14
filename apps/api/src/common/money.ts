import { Prisma } from '@prisma/client';

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export const D = (v: Prisma.Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);

export const round2 = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const ZERO = new Decimal(0);

export interface PricedLine {
  quantity: number | Decimal;
  unitPrice: number | Decimal;
  discountPct?: number | Decimal;
  taxRate?: number | Decimal;
}

/** Net line amount (after discount, before tax) and its tax, both rounded to cents. */
export function computeLine(line: PricedLine) {
  const gross = D(line.quantity).mul(D(line.unitPrice));
  const net = round2(gross.mul(D(100).minus(D(line.discountPct)).div(100)));
  const taxAmount = round2(net.mul(D(line.taxRate)).div(100));
  return { lineTotal: net, taxAmount };
}

export function sumTotals(lines: { lineTotal: Decimal; taxAmount: Decimal }[]) {
  const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO);
  const taxTotal = lines.reduce((s, l) => s.plus(l.taxAmount), ZERO);
  return { subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}
