import { computeLine, D, round2, sumTotals } from './money';

describe('money', () => {
  it('computes net amount after discount and tax on the net', () => {
    const { lineTotal, taxAmount } = computeLine({ quantity: 4, unitPrice: 899, discountPct: 5, taxRate: 15 });
    expect(lineTotal.toFixed(2)).toBe('3416.20');
    expect(taxAmount.toFixed(2)).toBe('512.43');
  });

  it('rounds half up to cents', () => {
    expect(round2(D('0.125')).toFixed(2)).toBe('0.13');
    expect(round2(D('2.675')).toFixed(2)).toBe('2.68'); // would be 2.67 with binary floats
    expect(round2(D('-0.125')).toFixed(2)).toBe('-0.13');
  });

  it('avoids floating point drift on fractional quantities', () => {
    const { lineTotal } = computeLine({ quantity: 0.1, unitPrice: 0.2 });
    expect(lineTotal.toFixed(2)).toBe('0.02');
    expect(computeLine({ quantity: 3, unitPrice: 33.33, taxRate: 0 }).lineTotal.toFixed(2)).toBe('99.99');
  });

  it('treats missing discount and tax as zero', () => {
    expect(computeLine({ quantity: 2, unitPrice: 10 })).toEqual({ lineTotal: D(20), taxAmount: D(0) });
  });

  it('sums line totals into document totals', () => {
    const totals = sumTotals([computeLine({ quantity: 1, unitPrice: 100, taxRate: 15 }), computeLine({ quantity: 3, unitPrice: 50, taxRate: 0 })]);
    expect(totals.subtotal.toFixed(2)).toBe('250.00');
    expect(totals.taxTotal.toFixed(2)).toBe('15.00');
    expect(totals.total.toFixed(2)).toBe('265.00');
  });
});
