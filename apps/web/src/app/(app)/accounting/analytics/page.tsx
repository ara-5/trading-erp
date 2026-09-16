'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, Loading, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { useGet } from '@/lib/hooks';

interface Analytics {
  financials: { month: string; income: number; expense: number; netProfit: number }[];
  cashTrend: { month: string; balance: number }[];
  topCustomers: { customerId: string; name: string; revenue: number }[];
  aging: {
    receivables: { current: string; d1_30: string; d31_60: string; d61_90: string; d90plus: string };
    payables: { current: string; d1_30: string; d31_60: string; d61_90: string; d90plus: string };
  };
}

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const axisTick = { fill: '#94a3b8', fontSize: 11 };
const gridStroke = 'currentColor';

function ChartTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <p className="mb-1 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name ?? p.dataKey)} className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="tabular font-medium">{money(p.value as number)}</span>
        </p>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading } = useGet<Analytics>('/accounting/analytics');
  if (isLoading || !data) return <Loading />;

  const financials = data.financials.map((f) => ({ ...f, label: monthLabel(f.month) }));
  const cashTrend = data.cashTrend.map((c) => ({ ...c, label: monthLabel(c.month) }));
  const aging = [
    ['Current', data.aging.receivables.current, data.aging.payables.current],
    ['1-30d', data.aging.receivables.d1_30, data.aging.payables.d1_30],
    ['31-60d', data.aging.receivables.d31_60, data.aging.payables.d31_60],
    ['61-90d', data.aging.receivables.d61_90, data.aging.payables.d61_90],
    ['90d+', data.aging.receivables.d90plus, data.aging.payables.d90plus],
  ].map(([bucket, receivables, payables]) => ({ bucket, receivables: Number(receivables), payables: Number(payables) }));
  const maxCustomerRevenue = Math.max(1, ...data.topCustomers.map((c) => c.revenue));

  return (
    <>
      <PageHeader title="Analytics" subtitle="12-month trends across cash, profitability, and who owes what" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Cash & bank balance">
          <div className="text-slate-500 dark:text-slate-400">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={cashTrend}>
                <defs>
                  <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={gridStroke} strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(v, { compact: true })} />
                <Tooltip content={ChartTooltip} />
                <Area type="monotone" dataKey="balance" name="Cash & bank" stroke="#6366f1" strokeWidth={2} fill="url(#cashFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Income vs. expense">
          <div className="text-slate-500 dark:text-slate-400">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={financials}>
                <CartesianGrid stroke={gridStroke} strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(v, { compact: true })} />
                <Tooltip content={ChartTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="#f43f5e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Net profit trend">
          <div className="text-slate-500 dark:text-slate-400">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={financials}>
                <CartesianGrid stroke={gridStroke} strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(v, { compact: true })} />
                <Tooltip content={ChartTooltip} />
                <Line type="monotone" dataKey="netProfit" name="Net profit" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Receivables & payables aging">
          <div className="text-slate-500 dark:text-slate-400">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={aging}>
                <CartesianGrid stroke={gridStroke} strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="bucket" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => money(v, { compact: true })} />
                <Tooltip content={ChartTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receivables" name="Receivables" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="payables" name="Payables" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Top customers (12 months)" className="lg:col-span-2" padded={false}>
          {data.topCustomers.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No revenue yet</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.topCustomers.map((c) => (
                <li key={c.customerId} className="flex items-center gap-4 px-4 py-3">
                  <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{c.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(c.revenue / maxCustomerRevenue) * 100}%` }} />
                  </div>
                  <span className="tabular w-24 shrink-0 text-right text-sm font-medium text-slate-900 dark:text-slate-100">{money(c.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
