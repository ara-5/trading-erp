import { allocate } from './allocate';
import { D, Decimal } from './money';

const lines = [
  { id: 'a', productId: 'p1', cap: 3 },
  { id: 'b', productId: 'p2', cap: 10 },
  { id: 'c', productId: 'p1', cap: 5 },
];
const capacity = (l: (typeof lines)[number]) => D(l.cap);

describe('allocate', () => {
  it('fills matching lines in order', () => {
    const result = allocate(lines, 'p1', D(6), capacity, new Map());
    expect(result?.map((r) => [r.line.id, r.qty.toNumber()])).toEqual([
      ['a', 3],
      ['c', 3],
    ]);
  });

  it('returns null when there is not enough capacity', () => {
    expect(allocate(lines, 'p1', D(9), capacity, new Map())).toBeNull();
  });

  it('shares capacity across calls through the used map', () => {
    const used = new Map<string, Decimal>();
    allocate(lines, 'p1', D(4), capacity, used);
    const second = allocate(lines, 'p1', D(4), capacity, used);
    expect(second?.map((r) => [r.line.id, r.qty.toNumber()])).toEqual([['c', 4]]);
    expect(allocate(lines, 'p1', D(1), capacity, used)).toBeNull();
  });

  it('ignores other products', () => {
    expect(allocate(lines, 'p3', D(1), capacity, new Map())).toBeNull();
  });
});
