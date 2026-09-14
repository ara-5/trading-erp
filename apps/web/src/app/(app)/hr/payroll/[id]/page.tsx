'use client';

import { Banknote, CheckCircle2, Printer, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCashAccounts } from '@/components/modals';
import { Button, Card, ConfirmButton, Field, Input, Loading, Modal, PageHeader, Select, Stat, StatusBadge } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';

interface Payslip {
  id: string;
  baseSalary: string;
  allowances: string;
  overtime: string;
  unpaidLeaveDeduction: string;
  otherDeductions: string;
  taxAmount: string;
  grossPay: string;
  netPay: string;
  employee: { id: string; code: string; firstName: string; lastName: string; jobTitle: string | null; bankAccount: string | null };
}
interface Run {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: string;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  payslips: Payslip[];
}

export default function PayrollRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: run } = useGet<Run>(`/hr/payroll/${id}`);
  const [paying, setPaying] = useState(false);

  const approve = useAction(() => post(`/hr/payroll/${id}/approve`), { success: 'Payroll approved and posted' });
  const remove = useAction(() => del(`/hr/payroll/${id}`), { success: 'Payroll run deleted', onSuccess: () => router.push('/hr/payroll') });

  if (!run) return <Loading />;
  const draft = run.status === 'DRAFT';

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {run.number} <StatusBadge status={run.status} />
          </span>
        }
        subtitle={`${date(run.periodStart)} – ${date(run.periodEnd)} · pay date ${date(run.payDate)}`}
        back="/hr/payroll"
        actions={
          <>
            <Button variant="ghost" onClick={() => window.print()} aria-label="Print">
              <Printer className="size-4" />
            </Button>
            {draft && (
              <>
                <ConfirmButton variant="danger" message="Delete this draft payroll run?" onConfirm={() => remove.mutate()}>
                  <Trash2 className="size-4" /> Delete
                </ConfirmButton>
                <Button loading={approve.isPending} onClick={() => approve.mutate()}>
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
              </>
            )}
            {run.status === 'APPROVED' && (
              <Button onClick={() => setPaying(true)}>
                <Banknote className="size-4" /> Pay salaries
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Gross pay" value={money(run.totalGross)} />
        <Stat label="Tax & deductions" value={money(run.totalDeductions)} />
        <Stat label="Net pay" value={money(run.totalNet)} />
      </div>

      <Card title="Payslips" className="mt-4" padded={false} actions={draft && <span className="text-xs text-slate-500">Edit overtime and deductions, then approve</span>}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Employee</th>
                <th className="px-3 py-2.5 text-right">Base</th>
                <th className="px-3 py-2.5 text-right">Allowances</th>
                <th className="px-3 py-2.5 text-right">Overtime</th>
                <th className="px-3 py-2.5 text-right">Unpaid leave</th>
                <th className="px-3 py-2.5 text-right">Gross</th>
                <th className="px-3 py-2.5 text-right">Tax</th>
                <th className="px-3 py-2.5 text-right">Other ded.</th>
                <th className="px-4 py-2.5 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {run.payslips.map((p) => (
                <PayslipRow key={`${p.id}-${p.overtime}-${p.otherDeductions}`} runId={run.id} slip={p} editable={draft} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {paying && <PayModal runId={run.id} total={run.totalNet} onClose={() => setPaying(false)} />}
    </>
  );
}

function PayslipRow({ runId, slip, editable }: { runId: string; slip: Payslip; editable: boolean }) {
  const [overtime, setOvertime] = useState(String(Number(slip.overtime)));
  const [other, setOther] = useState(String(Number(slip.otherDeductions)));
  const save = useAction(() => patch(`/hr/payroll/${runId}/payslips/${slip.id}`, { overtime: Number(overtime || 0), otherDeductions: Number(other || 0) }));
  const commit = () => {
    if (Number(overtime || 0) !== Number(slip.overtime) || Number(other || 0) !== Number(slip.otherDeductions)) save.mutate();
  };
  const cell = 'tabular px-3 py-2 text-right';

  return (
    <tr>
      <td className="px-4 py-2">
        <p className="font-medium text-slate-900">
          {slip.employee.firstName} {slip.employee.lastName}
        </p>
        <p className="text-xs text-slate-500">{slip.employee.bankAccount ?? slip.employee.code}</p>
      </td>
      <td className={cell}>{money(slip.baseSalary)}</td>
      <td className={cell}>{money(slip.allowances)}</td>
      <td className={cell}>
        {editable ? <Input type="number" min="0" step="0.01" value={overtime} onChange={(e) => setOvertime(e.target.value)} onBlur={commit} className="ml-auto h-8 w-24 text-right" /> : money(slip.overtime)}
      </td>
      <td className={`${cell} ${Number(slip.unpaidLeaveDeduction) ? 'text-rose-600' : ''}`}>{Number(slip.unpaidLeaveDeduction) ? `−${money(slip.unpaidLeaveDeduction)}` : '—'}</td>
      <td className={`${cell} font-medium`}>{money(slip.grossPay)}</td>
      <td className={cell}>{money(slip.taxAmount)}</td>
      <td className={cell}>
        {editable ? <Input type="number" min="0" step="0.01" value={other} onChange={(e) => setOther(e.target.value)} onBlur={commit} className="ml-auto h-8 w-24 text-right" /> : money(slip.otherDeductions)}
      </td>
      <td className="tabular px-4 py-2 text-right font-semibold text-slate-900">{money(slip.netPay)}</td>
    </tr>
  );
}

function PayModal({ runId, total, onClose }: { runId: string; total: string; onClose: () => void }) {
  const cash = useCashAccounts();
  const [accountId, setAccountId] = useState('');
  const chosen = accountId || cash.find((a) => /bank/i.test(a.name))?.id || cash[0]?.id || '';
  const pay = useAction(() => post(`/hr/payroll/${runId}/pay`, { accountId: chosen }), { success: 'Salaries paid', onSuccess: onClose });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Pay salaries"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pay.isPending} disabled={!chosen} onClick={() => pay.mutate()}>
            Pay {money(total)}
          </Button>
        </>
      }
    >
      <Field label="Pay from">
        <Select value={chosen} onChange={(e) => setAccountId(e.target.value)}>
          {cash.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} · {a.name}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
