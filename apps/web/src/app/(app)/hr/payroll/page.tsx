'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { Button, Field, Input, Modal, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAction, useFields } from '@/lib/hooks';

interface Run {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalGross: string;
  totalNet: string;
  _count: { payslips: number };
}

export default function PayrollPage() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <ListPage<Run>
        title="Payroll"
        subtitle="Monthly payroll runs post salary expense and liabilities to the ledger"
        endpoint="/hr/payroll"
        statuses={['DRAFT', 'APPROVED', 'PAID']}
        rowHref={(r) => `/hr/payroll/${r.id}`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New payroll run
          </Button>
        }
        columns={[
          { key: 'number', header: 'Run', cell: (r) => <span className="font-medium text-slate-900 dark:text-slate-100">{r.number}</span> },
          { key: 'period', header: 'Period', cell: (r) => `${date(r.periodStart)} – ${date(r.periodEnd)}` },
          { key: 'pay', header: 'Pay date', cell: (r) => date(r.payDate) },
          { key: 'count', header: 'Employees', align: 'right', cell: (r) => r._count.payslips },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          { key: 'gross', header: 'Gross', align: 'right', cell: (r) => money(r.totalGross) },
          { key: 'net', header: 'Net pay', align: 'right', cell: (r) => money(r.totalNet) },
        ]}
      />
      {creating && <NewRunModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewRunModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
  const [f, set] = useFields({ periodStart: start, periodEnd: end, payDate: end });
  const create = useAction(() => post<{ id: string }>('/hr/payroll', f), {
    success: 'Payroll run generated',
    onSuccess: (r) => router.push(`/hr/payroll/${r.id}`),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll run"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="run-form" loading={create.isPending}>
            Generate payslips
          </Button>
        </>
      }
    >
      <form
        id="run-form"
        className="grid grid-cols-3 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Period start">
          <Input type="date" required value={f.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
        </Field>
        <Field label="Period end">
          <Input type="date" required value={f.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
        </Field>
        <Field label="Pay date">
          <Input type="date" required value={f.payDate} onChange={(e) => set('payDate', e.target.value)} />
        </Field>
        <p className="col-span-3 text-xs text-slate-500 dark:text-slate-400">
          Payslips are generated for all non-terminated employees, with approved unpaid leave deducted pro-rata over working days.
        </p>
      </form>
    </Modal>
  );
}
