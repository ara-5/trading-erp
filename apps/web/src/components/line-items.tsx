'use client';

import { Plus, Trash2 } from 'lucide-react';
import { cn, money, num } from '@/lib/format';
import { useOptions } from '@/lib/hooks';
import { Button, Input, Select } from './ui';

export interface Product {
  id: string;
  sku: string;
  name: string;
  uom: string;
  salePrice: string;
  costPrice: string;
  trackInventory: boolean;
  isActive: boolean;
  taxRate?: { rate: string } | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface LineDraft {
  key: string;
  productId: string;
  accountId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
}

let seq = 0;
export const newLine = (patch: Partial<LineDraft> = {}): LineDraft => ({
  key: `l${++seq}`,
  productId: '',
  accountId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discountPct: '0',
  taxRate: '0',
  ...patch,
});

/** Converts server line rows (decimals as strings) into editable drafts. */
export const toDrafts = (
  lines: { productId: string | null; accountId?: string | null; description: string | null; quantity: string; unitPrice: string; discountPct?: string; taxRate: string }[],
) =>
  lines.map((l) =>
    newLine({
      productId: l.productId ?? '',
      accountId: l.accountId ?? '',
      description: l.description ?? '',
      quantity: String(Number(l.quantity)),
      unitPrice: String(Number(l.unitPrice)),
      discountPct: String(Number(l.discountPct ?? 0)),
      taxRate: String(Number(l.taxRate)),
    }),
  );

export function lineAmounts(l: LineDraft) {
  const net = Math.round(Number(l.quantity || 0) * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100) * 100) / 100;
  const tax = Math.round(net * Number(l.taxRate || 0)) / 100;
  return { net, tax };
}

export function linesPayload(lines: LineDraft[], opts: { discount?: boolean; account?: boolean } = {}) {
  return lines
    .filter((l) => l.productId || l.accountId || l.description)
    .map((l) => ({
      productId: l.productId || null,
      ...(opts.account ? { accountId: l.accountId || null } : {}),
      description: l.description || null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice || 0),
      ...(opts.discount ? { discountPct: Number(l.discountPct || 0) } : {}),
      taxRate: Number(l.taxRate || 0),
    }));
}

export function LineItems({
  lines,
  onChange,
  priceField = 'salePrice',
  showDiscount = false,
  allowAccount = false,
  productFilter,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  priceField?: 'salePrice' | 'costPrice';
  showDiscount?: boolean;
  allowAccount?: boolean;
  productFilter?: (p: Product) => boolean;
}) {
  const products = useOptions<Product>('/inventory/products');
  const accounts = useOptions<Account>('/accounting/accounts');
  const expenseAccounts = accounts.filter((a) => a.type === 'EXPENSE' || a.type === 'ASSET');

  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: string, id: string) => {
    const p = products.find((x) => x.id === id);
    update(key, {
      productId: id,
      accountId: '',
      description: p?.name ?? '',
      unitPrice: p ? String(Number(p[priceField])) : '',
      taxRate: String(Number(p?.taxRate?.rate ?? 0)),
    });
  };

  const totals = lines.reduce(
    (t, l) => {
      const { net, tax } = lineAmounts(l);
      return { subtotal: t.subtotal + net, tax: t.tax + tax };
    },
    { subtotal: 0, tax: 0 },
  );

  const selectable = products.filter((p) => p.isActive && (!productFilter || productFilter(p)));
  const numCell = 'h-8 text-right tabular';

  return (
    <div>
      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">{allowAccount ? 'Product / account' : 'Product'}</th>
              <th className="px-2 py-2 text-left">Description</th>
              <th className="w-24 px-2 py-2 text-right">Qty</th>
              <th className="w-28 px-2 py-2 text-right">Unit price</th>
              {showDiscount && <th className="w-20 px-2 py-2 text-right">Disc %</th>}
              <th className="w-20 px-2 py-2 text-right">Tax %</th>
              <th className="w-28 px-2 py-2 text-right">Amount</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.key} className="align-top">
                <td className="min-w-52 px-2 py-1.5">
                  <Select value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value)} className="h-8">
                    <option value="">{allowAccount ? '— No product —' : 'Select product…'}</option>
                    {selectable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </Select>
                  {allowAccount && !l.productId && (
                    <Select value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })} className="mt-1 h-8">
                      <option value="">Expense account…</option>
                      {expenseAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="min-w-48 px-2 py-1.5">
                  <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className="h-8" />
                </td>
                <td className="px-2 py-1.5">
                  <Input type="number" min="0" step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} className={numCell} />
                </td>
                <td className="px-2 py-1.5">
                  <Input type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} className={numCell} />
                </td>
                {showDiscount && (
                  <td className="px-2 py-1.5">
                    <Input type="number" min="0" max="100" step="any" value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} className={numCell} />
                  </td>
                )}
                <td className="px-2 py-1.5">
                  <Input type="number" min="0" max="100" step="any" value={l.taxRate} onChange={(e) => update(l.key, { taxRate: e.target.value })} className={numCell} />
                </td>
                <td className="tabular px-2 py-3 text-right text-slate-800">{money(lineAmounts(l).net)}</td>
                <td className="px-1 py-1.5">
                  <button
                    type="button"
                    onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                    disabled={lines.length === 1}
                    className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Button variant="secondary" size="sm" onClick={() => onChange([...lines, newLine()])}>
          <Plus className="size-4" /> Add line
        </Button>
        <Totals subtotal={totals.subtotal} taxTotal={totals.tax} total={totals.subtotal + totals.tax} />
      </div>
    </div>
  );
}

export function Totals({ subtotal, taxTotal, total, amountPaid }: { subtotal: string | number; taxTotal: string | number; total: string | number; amountPaid?: string | number }) {
  const rows: [string, string | number, boolean?][] = [
    ['Subtotal', subtotal],
    ['Tax', taxTotal],
    ['Total', total, true],
  ];
  if (amountPaid !== undefined) {
    rows.push(['Paid', amountPaid], ['Balance due', Number(total) - Number(amountPaid), true]);
  }
  return (
    <dl className="w-full space-y-1 text-sm sm:w-64">
      {rows.map(([k, v, strong]) => (
        <div key={k} className={cn('flex justify-between', strong && 'border-t border-slate-200 pt-1 font-semibold text-slate-900')}>
          <dt className={strong ? '' : 'text-slate-500'}>{k}</dt>
          <dd className="tabular">{money(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DocLine {
  id: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountPct?: string;
  taxRate: string;
  lineTotal: string;
  receivedQty?: string;
  deliveredQty?: string;
  invoicedQty?: string;
  billedQty?: string;
  product?: { sku: string; name: string; uom: string } | null;
  account?: { code: string; name: string } | null;
}

/** Read-only lines table for document detail pages, with optional fulfilment columns. */
export function LinesTable({ lines, progress }: { lines: DocLine[]; progress?: { key: keyof DocLine; label: string }[] }) {
  const showDiscount = lines.some((l) => Number(l.discountPct ?? 0) > 0);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 text-left">Item</th>
            <th className="px-4 py-2.5 text-right">Qty</th>
            {progress?.map((p) => (
              <th key={p.label} className="px-4 py-2.5 text-right">
                {p.label}
              </th>
            ))}
            <th className="px-4 py-2.5 text-right">Unit price</th>
            {showDiscount && <th className="px-4 py-2.5 text-right">Disc</th>}
            <th className="px-4 py-2.5 text-right">Tax</th>
            <th className="px-4 py-2.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-2.5">
                <p className="font-medium text-slate-800">{l.description ?? l.product?.name}</p>
                <p className="text-xs text-slate-500">{l.product ? `${l.product.sku}` : l.account ? `${l.account.code} · ${l.account.name}` : ''}</p>
              </td>
              <td className="tabular px-4 py-2.5 text-right">
                {num(l.quantity)} <span className="text-xs text-slate-400">{l.product?.uom}</span>
              </td>
              {progress?.map((p) => (
                <td key={p.label} className="tabular px-4 py-2.5 text-right">
                  <span className={Number(l[p.key]) >= Number(l.quantity) ? 'text-emerald-700' : 'text-slate-700'}>{num(l[p.key] as string)}</span>
                </td>
              ))}
              <td className="tabular px-4 py-2.5 text-right">{money(l.unitPrice)}</td>
              {showDiscount && <td className="tabular px-4 py-2.5 text-right">{num(l.discountPct)}%</td>}
              <td className="tabular px-4 py-2.5 text-right">{num(l.taxRate)}%</td>
              <td className="tabular px-4 py-2.5 text-right font-medium text-slate-900">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
