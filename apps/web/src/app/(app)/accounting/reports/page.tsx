'use client';

import { Printer } from 'lucide-react';
import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { cn, date, money, today } from '@/lib/format';
import { useGet, useOptions } from '@/lib/hooks';

type Tab = 'pl' | 'bs' | 'tb' | 'ar' | 'ap' | 'ledger';
const TABS: [Tab, string][] = [
  ['pl', 'Profit & loss'],
  ['bs', 'Balance sheet'],
  ['tb', 'Trial balance'],
  ['ar', 'Receivables aging'],
  ['ap', 'Payables aging'],
  ['ledger', 'General ledger'],
];

interface Row {
  id: string;
  code: string;
  name: string;
  balance: string;
}

const yearStart = () => `${new Date().getUTCFullYear()}-01-01`;

export default function ReportsPage() {
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'pl');
  const [from, setFrom] = useState(yearStart());
  const [to, setTo] = useState(today());
  const [accountId, setAccountId] = useState(params.get('accountId') ?? '');

  const usesRange = tab === 'pl' || tab === 'ledger';

  return (
    <>
      <PageHeader
        title="Financial reports"
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium', tab === key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100')}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          {usesRange && (
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          )}
          <Field label={usesRange ? 'To' : 'As of'}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {tab === 'ledger' && <AccountPicker value={accountId} onChange={setAccountId} />}
        </div>
      </Card>

      {tab === 'pl' && <ProfitLoss from={from} to={to} />}
      {tab === 'bs' && <BalanceSheet asOf={to} />}
      {tab === 'tb' && <TrialBalance asOf={to} />}
      {tab === 'ar' && <Aging kind="receivables" asOf={to} />}
      {tab === 'ap' && <Aging kind="payables" asOf={to} />}
      {tab === 'ledger' && (accountId ? <Ledger accountId={accountId} from={from} to={to} /> : <p className="text-sm text-slate-500">Choose an account to view its ledger.</p>)}
    </>
  );
}

function AccountPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const accounts = useOptions<{ id: string; code: string; name: string }>('/accounting/accounts', { includeInactive: 'true' });
  return (
    <Field label="Account" className="min-w-64">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select account…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} · {a.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Section({ title, rows, total, totalLabel }: { title: string; rows: Row[]; total: string | number; totalLabel: string }) {
  return (
    <div className="mb-6">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">
                {/* Full navigation so the page re-reads its tab/account from the URL. */}
                <a href={`/accounting/reports?tab=ledger&accountId=${r.id}`} className="text-slate-700 hover:text-indigo-600">
                  <span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>
                  {r.name}
                </a>
              </td>
              <td className="tabular py-1.5 text-right">{money(r.balance)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="py-1.5 text-slate-400" colSpan={2}>
                No activity
              </td>
            </tr>
          )}
          <tr className="font-semibold text-slate-900">
            <td className="pt-2">{totalLabel}</td>
            <td className="tabular pt-2 text-right">{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ReportCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-5 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <div className="mx-auto max-w-2xl">{children}</div>
    </Card>
  );
}

function ProfitLoss({ from, to }: { from: string; to: string }) {
  const { data } = useGet<{ income: Row[]; expenses: Row[]; totalIncome: string; totalExpenses: string; netProfit: string }>('/accounting/reports/profit-loss', { from, to });
  if (!data) return <Loading />;
  const net = Number(data.netProfit);
  return (
    <ReportCard title="Profit & loss" subtitle={`${date(from)} – ${date(to)}`}>
      <Section title="Income" rows={data.income} total={data.totalIncome} totalLabel="Total income" />
      <Section title="Expenses" rows={data.expenses} total={data.totalExpenses} totalLabel="Total expenses" />
      <div className={cn('flex justify-between rounded-lg px-4 py-3 text-base font-semibold', net >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
        <span>{net >= 0 ? 'Net profit' : 'Net loss'}</span>
        <span className="tabular">{money(data.netProfit)}</span>
      </div>
    </ReportCard>
  );
}

function BalanceSheet({ asOf }: { asOf: string }) {
  const { data } = useGet<{
    assets: Row[];
    liabilities: Row[];
    equity: Row[];
    currentEarnings: string;
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    balanced: boolean;
  }>('/accounting/reports/balance-sheet', { asOf });
  if (!data) return <Loading />;
  const equityRows = [...data.equity, { id: 'earnings', code: '', name: 'Current earnings (unclosed)', balance: data.currentEarnings }];
  return (
    <ReportCard title="Balance sheet" subtitle={`As of ${date(asOf)}`}>
      <div className="mb-4 text-center">{data.balanced ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">Out of balance</Badge>}</div>
      <Section title="Assets" rows={data.assets} total={data.totalAssets} totalLabel="Total assets" />
      <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} totalLabel="Total liabilities" />
      <Section title="Equity" rows={equityRows} total={data.totalEquity} totalLabel="Total equity" />
      <div className="flex justify-between border-t-2 border-slate-900 pt-2 font-semibold">
        <span>Total liabilities & equity</span>
        <span className="tabular">{money(Number(data.totalLiabilities) + Number(data.totalEquity))}</span>
      </div>
    </ReportCard>
  );
}

function TrialBalance({ asOf }: { asOf: string }) {
  const { data } = useGet<{ rows: (Row & { type: string; debit: string; credit: string })[]; totalDebit: string; totalCredit: string }>('/accounting/reports/trial-balance', { asOf });
  if (!data) return <Loading />;
  return (
    <ReportCard title="Trial balance" subtitle={`As of ${date(asOf)}`}>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 text-left">Account</th>
            <th className="py-2 text-right">Debit</th>
            <th className="py-2 text-right">Credit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">
                <span className="mr-2 font-mono text-xs text-slate-400">{r.code}</span>
                {r.name}
              </td>
              <td className="tabular py-1.5 text-right">{Number(r.debit) ? money(r.debit) : ''}</td>
              <td className="tabular py-1.5 text-right">{Number(r.credit) ? money(r.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-900 font-semibold">
          <tr>
            <td className="py-2">Total</td>
            <td className="tabular py-2 text-right">{money(data.totalDebit)}</td>
            <td className="tabular py-2 text-right">{money(data.totalCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </ReportCard>
  );
}

const BUCKETS: [string, string][] = [
  ['current', 'Current'],
  ['d1_30', '1–30'],
  ['d31_60', '31–60'],
  ['d61_90', '61–90'],
  ['d90plus', '90+'],
  ['total', 'Total'],
];

function Aging({ kind, asOf }: { kind: 'receivables' | 'payables'; asOf: string }) {
  const { data } = useGet<{ rows: (Record<string, string> & { partyId: string; partyName: string })[]; totals: Record<string, string> }>(`/accounting/reports/aging/${kind}`, { asOf });
  if (!data) return <Loading />;
  const href = kind === 'receivables' ? '/sales/customers/' : '/purchasing/suppliers/';
  return (
    <Card title={`${kind === 'receivables' ? 'Receivables' : 'Payables'} aging — days overdue as of ${date(asOf)}`} padded={false}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left">{kind === 'receivables' ? 'Customer' : 'Supplier'}</th>
              {BUCKETS.map(([k, l]) => (
                <th key={k} className="px-4 py-2.5 text-right">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.map((r) => (
              <tr key={r.partyId}>
                <td className="px-4 py-2">
                  <Link href={href + r.partyId} className="text-slate-800 hover:text-indigo-600">
                    {r.partyName}
                  </Link>
                </td>
                {BUCKETS.map(([k]) => (
                  <td key={k} className={cn('tabular px-4 py-2 text-right', k === 'total' && 'font-semibold', k === 'd90plus' && Number(r[k]) > 0 && 'text-rose-600')}>
                    {Number(r[k]) ? money(r[k]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  Nothing outstanding
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
            <tr>
              <td className="px-4 py-2.5">Total</td>
              {BUCKETS.map(([k]) => (
                <td key={k} className="tabular px-4 py-2.5 text-right">
                  {money(data.totals[k])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function Ledger({ accountId, from, to }: { accountId: string; from: string; to: string }) {
  const { data } = useGet<{
    account: { code: string; name: string };
    opening: string;
    closing: string;
    rows: { id: string; number: string; date: string; description: string; lineDescription: string | null; debit: string; credit: string; balance: string }[];
  }>(`/accounting/reports/general-ledger/${accountId}`, { from, to });
  if (!data) return <Loading />;
  return (
    <Card title={`${data.account.code} · ${data.account.name}`} padded={false}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left">Date</th>
              <th className="px-4 py-2.5 text-left">Entry</th>
              <th className="px-4 py-2.5 text-left">Description</th>
              <th className="px-4 py-2.5 text-right">Debit</th>
              <th className="px-4 py-2.5 text-right">Credit</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-slate-50/50 text-slate-500">
              <td className="px-4 py-2" colSpan={5}>
                Opening balance
              </td>
              <td className="tabular px-4 py-2 text-right">{money(data.opening)}</td>
            </tr>
            {data.rows.map((r, i) => (
              <tr key={`${r.id}-${i}`}>
                <td className="px-4 py-2">{date(r.date)}</td>
                <td className="px-4 py-2">
                  <Link href={`/accounting/journals/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                    {r.number}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-700">{r.lineDescription ?? r.description}</td>
                <td className="tabular px-4 py-2 text-right">{Number(r.debit) ? money(r.debit) : ''}</td>
                <td className="tabular px-4 py-2 text-right">{Number(r.credit) ? money(r.credit) : ''}</td>
                <td className="tabular px-4 py-2 text-right font-medium">{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
            <tr>
              <td className="px-4 py-2.5" colSpan={5}>
                Closing balance
              </td>
              <td className="tabular px-4 py-2.5 text-right">{money(data.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
