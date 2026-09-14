'use client';

import { Plus } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Loading, PageHeader, Select, Textarea } from '@/components/ui';
import { patch, post, put } from '@/lib/api';
import { humanize } from '@/lib/format';
import { useAction, useFields, useGet, useOptions } from '@/lib/hooks';

interface Settings {
  name: string;
  legalName: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  fiscalYearStart: number;
}

const SYSTEM_KEYS = [
  'CASH',
  'BANK',
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'INVENTORY',
  'GOODS_RECEIVED_NOT_BILLED',
  'SALES_REVENUE',
  'COST_OF_GOODS_SOLD',
  'INVENTORY_ADJUSTMENT',
  'TAX_PAYABLE',
  'TAX_RECEIVABLE',
  'SALARY_EXPENSE',
  'SALARY_PAYABLE',
  'PAYROLL_TAX_PAYABLE',
  'RETAINED_EARNINGS',
];

export default function SettingsPage() {
  const settings = useGet<Settings | null>('/admin/settings');
  if (settings.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Company settings" />
      <div className="space-y-6">
        <CompanyForm initial={settings.data ?? null} />
        <SystemAccounts />
        <TaxRates />
      </div>
    </>
  );
}

function CompanyForm({ initial }: { initial: Settings | null }) {
  const [f, set] = useFields({
    name: initial?.name ?? '',
    legalName: initial?.legalName ?? '',
    taxNumber: initial?.taxNumber ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    currency: initial?.currency ?? 'USD',
    fiscalYearStart: String(initial?.fiscalYearStart ?? 1),
  });
  const save = useAction(
    () =>
      put('/admin/settings', {
        ...f,
        legalName: f.legalName || null,
        taxNumber: f.taxNumber || null,
        email: f.email || null,
        phone: f.phone || null,
        address: f.address || null,
        fiscalYearStart: Number(f.fiscalYearStart),
      }),
    { success: 'Settings saved' },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Card title="Company profile">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Company name" className="sm:col-span-2">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Legal name" className="sm:col-span-2">
          <Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} />
        </Field>
        <Field label="Tax number">
          <Input value={f.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Currency (ISO code)">
          <Input required maxLength={3} value={f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Address" className="sm:col-span-3">
          <Textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Fiscal year starts">
          <Select value={f.fiscalYearStart} onChange={(e) => set('fiscalYearStart', e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" loading={save.isPending}>
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SystemAccounts() {
  const mapped = useGet<{ key: string; accountId: string }[]>('/admin/system-accounts');
  const accounts = useOptions<{ id: string; code: string; name: string; type: string }>('/accounting/accounts');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const current = (key: string) => overrides[key] ?? mapped.data?.find((m) => m.key === key)?.accountId ?? '';
  const save = useAction(() => put('/admin/system-accounts', Object.fromEntries(SYSTEM_KEYS.map((k) => [k, current(k)]).filter(([, v]) => v))), {
    success: 'Account mapping saved',
    onSuccess: () => setOverrides({}),
  });

  return (
    <Card
      title="System accounts"
      actions={
        <Button size="sm" disabled={!Object.keys(overrides).length} loading={save.isPending} onClick={() => save.mutate()}>
          Save mapping
        </Button>
      }
    >
      <p className="mb-4 text-sm text-slate-500">These accounts receive automatic postings from invoices, bills, payments, stock movements and payroll.</p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
        {SYSTEM_KEYS.map((key) => (
          <Field key={key} label={humanize(key)}>
            <Select value={current(key)} onChange={(e) => setOverrides({ ...overrides, [key]: e.target.value })}>
              <option value="">Not mapped</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
    </Card>
  );
}

function TaxRates() {
  const rates = useGet<{ id: string; name: string; rate: string; isActive: boolean }[]>('/accounting/tax-rates');
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const add = useAction(() => post('/accounting/tax-rates', { name, rate: Number(rate) }), {
    success: 'Tax rate added',
    onSuccess: () => {
      setName('');
      setRate('');
    },
  });
  const toggle = useAction((r: { id: string; isActive: boolean }) => patch(`/accounting/tax-rates/${r.id}`, { isActive: !r.isActive }));

  return (
    <Card title="Tax rates" padded={false}>
      <form
        className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reduced 5%" />
        </Field>
        <Field label="Rate %">
          <Input type="number" min="0" max="100" step="0.01" required value={rate} onChange={(e) => setRate(e.target.value)} className="w-28" />
        </Field>
        <Button type="submit" variant="secondary" loading={add.isPending}>
          <Plus className="size-4" /> Add
        </Button>
      </form>
      <DataTable
        rows={rates.data ?? []}
        columns={[
          { key: 'name', header: 'Name', cell: (r) => r.name },
          { key: 'rate', header: 'Rate', align: 'right', cell: (r) => `${Number(r.rate)}%` },
          { key: 'status', header: 'Status', cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
          { key: 'toggle', header: '', align: 'right', cell: (r) => <Checkbox label="Active" checked={r.isActive} onChange={() => toggle.mutate(r)} /> },
        ]}
      />
    </Card>
  );
}
