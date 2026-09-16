'use client';

import { Plus, UserCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { Button, Field, Input, Modal, Select, StatusBadge, Textarea } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { cn, date, humanize, money } from '@/lib/format';
import { useAction, useFields, useGet } from '@/lib/hooks';

const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'];

interface Lead {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  estimatedValue: string;
  notes: string | null;
  updatedAt: string;
  owner: { name: string } | null;
  customer: { id: string; name: string } | null;
}

export default function LeadsPage() {
  const [editing, setEditing] = useState<Lead | null | undefined>(undefined);
  const pipeline = useGet<{ status: string; count: number; value: string }[]>('/sales/leads/pipeline');

  return (
    <>
      <ListPage<Lead>
        title="Leads"
        subtitle="Track prospects through your sales pipeline"
        endpoint="/sales/leads"
        statuses={STATUSES}
        onRowClick={setEditing}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> New lead
          </Button>
        }
        columns={[
          {
            key: 'name',
            header: 'Lead',
            cell: (l) => (
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{l.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{l.company}</p>
              </div>
            ),
          },
          { key: 'contact', header: 'Contact', cell: (l) => l.email ?? l.phone ?? '—' },
          { key: 'source', header: 'Source', cell: (l) => l.source ?? '—' },
          { key: 'status', header: 'Stage', cell: (l) => <StatusBadge status={l.status} /> },
          { key: 'owner', header: 'Owner', cell: (l) => l.owner?.name ?? '—' },
          { key: 'value', header: 'Est. value', align: 'right', cell: (l) => money(l.estimatedValue) },
          { key: 'updated', header: 'Updated', cell: (l) => date(l.updatedAt) },
        ]}
      >
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STATUSES.map((s) => {
            const row = pipeline.data?.find((p) => p.status === s);
            return (
              <div key={s} className={cn('rounded-lg bg-white dark:bg-slate-900 px-3 py-2 ring-1 ring-slate-200 dark:ring-slate-800', s === 'WON' && 'ring-emerald-200', s === 'LOST' && 'ring-rose-200')}>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{humanize(s)}</p>
                <p className="tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {row?.count ?? 0} · {money(row?.value ?? 0)}
                </p>
              </div>
            );
          })}
        </div>
      </ListPage>
      {editing !== undefined && <LeadModal lead={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function LeadModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const router = useRouter();
  const [f, set] = useFields({
    name: lead?.name ?? '',
    company: lead?.company ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    source: lead?.source ?? '',
    status: lead?.status ?? 'NEW',
    estimatedValue: String(Number(lead?.estimatedValue ?? 0)),
    notes: lead?.notes ?? '',
  });
  const body = () => ({
    ...f,
    company: f.company || null,
    email: f.email || null,
    phone: f.phone || null,
    source: f.source || null,
    notes: f.notes || null,
    estimatedValue: Number(f.estimatedValue || 0),
  });
  const save = useAction(() => (lead ? patch(`/sales/leads/${lead.id}`, body()) : post('/sales/leads', body())), { success: 'Lead saved', onSuccess: onClose });
  const convert = useAction(() => post<{ id: string }>(`/sales/leads/${lead!.id}/convert`), {
    success: 'Lead converted to customer',
    onSuccess: (c) => router.push(`/sales/customers/${c.id}`),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={lead ? 'Edit lead' : 'New lead'}
      footer={
        <>
          {lead && !lead.customer && (
            <Button variant="secondary" className="mr-auto" loading={convert.isPending} onClick={() => convert.mutate()}>
              <UserCheck className="size-4" /> Convert to customer
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="lead-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Contact name">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Company">
          <Input value={f.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Stage">
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated value">
          <Input type="number" min="0" step="0.01" value={f.estimatedValue} onChange={(e) => set('estimatedValue', e.target.value)} />
        </Field>
        <Field label="Source" className="col-span-2">
          <Input value={f.source} onChange={(e) => set('source', e.target.value)} placeholder="Website, referral, trade show…" />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {lead?.customer && <p className="col-span-2 text-sm text-emerald-700 dark:text-emerald-400">Converted to customer {lead.customer.name}</p>}
      </form>
    </Modal>
  );
}
