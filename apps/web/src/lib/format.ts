let currency = 'USD';
export const setCurrency = (c: string) => {
  currency = c || 'USD';
};

type Num = string | number | null | undefined;

export const money = (v: Num) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(v ?? 0));

export const num = (v: Num, maxDigits = 3) => new Intl.NumberFormat(undefined, { maximumFractionDigits: maxDigits }).format(Number(v ?? 0));

export const date = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }) : '—';

export const dateTime = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const today = () => new Date().toISOString().slice(0, 10);

export const inputDate = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '');

export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
