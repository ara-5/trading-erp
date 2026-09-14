import { addDays, businessDays, daysBetween, endOfDay, startOfDay } from './dates';

describe('dates', () => {
  it('counts Monday–Friday inclusive', () => {
    // 2026-09-14 is a Monday.
    expect(businessDays(new Date('2026-09-14'), new Date('2026-09-20'))).toBe(5);
    expect(businessDays(new Date('2026-09-19'), new Date('2026-09-20'))).toBe(0);
    expect(businessDays(new Date('2026-09-18'), new Date('2026-09-21'))).toBe(2);
    expect(businessDays(new Date('2026-09-01'), new Date('2026-09-30'))).toBe(22);
  });

  it('normalises to UTC day boundaries', () => {
    const d = new Date('2026-09-14T15:30:00Z');
    expect(startOfDay(d).toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(endOfDay(d).toISOString()).toBe('2026-09-14T23:59:59.999Z');
  });

  it('measures whole days between dates regardless of time of day', () => {
    expect(daysBetween(new Date('2026-09-14T23:00:00Z'), new Date('2026-09-15T01:00:00Z'))).toBe(1);
    expect(daysBetween(new Date('2026-09-15'), new Date('2026-09-14'))).toBe(-1);
    expect(addDays(new Date('2026-12-31'), 1).toISOString().slice(0, 10)).toBe('2027-01-01');
  });
});
