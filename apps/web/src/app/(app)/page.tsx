'use client';

import { AlertTriangle, Banknote, CalendarDays, ClipboardList, Landmark, Receipt, ShoppingCart, Users } from 'lucide-react';
import Link from 'next/link';
import { Card, DataTable, Loading, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { date, money, num } from '@/lib/format';
import { useGet } from '@/lib/hooks';

interface Dashboard {
  kpis: {
    salesThisMonth: string;
    invoicesThisMonth: number;
    receivables: string;
    payables: string;
    cash: string;
    lowStock: number;
    openSalesOrders: number;
    openPurchaseOrders: number;
    headcount: number;
    pendingLeave: number;
  };
  trend: { month: string; sales: number; purchases: number }[];
  topProducts: { product?: { id: string; sku: string; name: string }; revenue: string; quantity: string }[];
  recentInvoices: { id: string; number: string; date: string; total: string; status: string; customer: { name: string } }[];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useGet<Dashboard>('/dashboard');

  if (isLoading || !data) return <Loading />;
  const k = data.kpis;

  return (
    <>
      <PageHeader title={`Welcome back, ${user?.name.split(' ')[0]}`} subtitle="Here's how the business is doing today." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sales this month" value={money(k.salesThisMonth)} hint={`${k.invoicesThisMonth} invoice(s), excl. tax`} icon={<Receipt className="size-4" />} />
        <Stat label="Cash & bank" value={money(k.cash)} icon={<Landmark className="size-4" />} />
        <Stat label="Receivables" value={money(k.receivables)} hint="Open customer invoices" icon={<Banknote className="size-4" />} />
        <Stat label="Payables" value={money(k.payables)} hint="Open supplier bills" icon={<Banknote className="size-4" />} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QuickStat href="/sales/orders?status=CONFIRMED" icon={<ShoppingCart className="size-4" />} label="Open sales orders" value={k.openSalesOrders} />
        <QuickStat href="/purchasing/orders?status=APPROVED" icon={<ClipboardList className="size-4" />} label="Open purchase orders" value={k.openPurchaseOrders} />
        <QuickStat href="/inventory/stock" icon={<AlertTriangle className="size-4" />} label="Low-stock items" value={k.lowStock} warn={k.lowStock > 0} />
        <QuickStat href="/hr/leave?status=PENDING" icon={<CalendarDays className="size-4" />} label="Pending leave" value={k.pendingLeave} sub={<><Users className="inline size-3" /> {k.headcount} employees</>} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Sales vs purchases (last 6 months)" className="lg:col-span-2">
          <TrendChart data={data.trend} />
        </Card>
        <Card title="Top products (90 days)" padded={false}>
          {data.topProducts.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">No sales yet</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.topProducts.map((t, i) => (
                <li key={t.product?.id ?? i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{t.product?.name}</p>
                    <p className="text-xs text-slate-500">
                      {t.product?.sku} · {num(t.quantity)} sold
                    </p>
                  </div>
                  <span className="tabular font-medium text-slate-900">{money(t.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent invoices" className="mt-6" padded={false} actions={<Link href="/sales/invoices" className="text-xs font-medium text-indigo-600 hover:text-indigo-500">View all</Link>}>
        <DataTable
          rows={data.recentInvoices}
          rowHref={(r) => `/sales/invoices/${r.id}`}
          empty="No invoices yet"
          columns={[
            { key: 'number', header: 'Invoice', cell: (r) => <span className="font-medium text-slate-900">{r.number}</span> },
            { key: 'customer', header: 'Customer', cell: (r) => r.customer.name },
            { key: 'date', header: 'Date', cell: (r) => date(r.date) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'total', header: 'Total', align: 'right', cell: (r) => money(r.total) },
          ]}
        />
      </Card>
    </>
  );
}

function QuickStat({ href, icon, label, value, warn, sub }: { href: string; icon: React.ReactNode; label: string; value: number; warn?: boolean; sub?: React.ReactNode }) {
  return (
    <Link href={href} className="group rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-indigo-300">
      <div className={`flex items-center gap-1.5 text-xs font-medium ${warn ? 'text-amber-700' : 'text-slate-500'}`}>
        {icon}
        {label}
      </div>
      <div className="tabular mt-1.5 text-xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Link>
  );
}

function TrendChart({ data }: { data: Dashboard['trend'] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.purchases]));
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-indigo-500" /> Sales
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-300" /> Purchases
        </span>
      </div>
      <div className="flex h-56 items-end gap-3">
        {data.map((d) => (
          <div key={d.month} className="flex h-full flex-1 flex-col justify-end">
            <div className="flex flex-1 items-end justify-center gap-1">
              <div
                className="w-full max-w-6 rounded-t bg-indigo-500 transition-all"
                style={{ height: `${(d.sales / max) * 100}%` }}
                title={`Sales ${money(d.sales)}`}
              />
              <div
                className="w-full max-w-6 rounded-t bg-slate-300 transition-all"
                style={{ height: `${(d.purchases / max) * 100}%` }}
                title={`Purchases ${money(d.purchases)}`}
              />
            </div>
            <div className="mt-2 text-center text-xs text-slate-500">{monthLabel(d.month)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
