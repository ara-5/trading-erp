const DAY = 86_400_000;

export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const endOfDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

export const daysBetween = (from: Date, to: Date) =>
  Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);

/** Monday–Friday days in [from, to], inclusive. */
export function businessDays(from: Date, to: Date): number {
  let n = 0;
  for (let t = startOfDay(from).getTime(); t <= startOfDay(to).getTime(); t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

export const maxDate = (a: Date, b: Date) => (a > b ? a : b);
export const minDate = (a: Date, b: Date) => (a < b ? a : b);
