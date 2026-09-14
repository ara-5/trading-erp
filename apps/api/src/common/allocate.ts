import { D, Decimal } from './money';

/**
 * Spreads `qty` of a product across the matching lines of a source document (e.g. sales order lines),
 * respecting each line's remaining capacity. `used` tracks what earlier calls already took, so several
 * target lines for the same product don't double-book one source line. Returns null if capacity is short.
 */
export function allocate<T extends { id: string; productId: string }>(
  lines: T[],
  productId: string,
  qty: Decimal,
  capacity: (line: T) => Decimal,
  used: Map<string, Decimal>,
): { line: T; qty: Decimal }[] | null {
  let remaining = qty;
  const out: { line: T; qty: Decimal }[] = [];
  for (const line of lines) {
    if (line.productId !== productId || remaining.lte(0)) continue;
    const free = capacity(line).minus(used.get(line.id) ?? 0);
    if (free.lte(0)) continue;
    const take = Decimal.min(free, remaining);
    out.push({ line, qty: take });
    used.set(line.id, D(used.get(line.id)).plus(take));
    remaining = remaining.minus(take);
  }
  return remaining.gt(0) ? null : out;
}
