'use client';

import { CalendarPlus, Pencil } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EmployeeModal, EmployeeRecord, LeaveRequestModal } from '@/components/hr-modals';
import { Button, Card, DataTable, DescriptionList, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { date, money, num } from '@/lib/format';
import { useGet } from '@/lib/hooks';

interface EmployeeDetail extends EmployeeRecord {
  department: { id: string; name: string } | null;
  leaveBalances: { leaveTypeId: string; name: string; entitled: number; taken: string; pending: string; remaining: string }[];
  leaveRequests: { id: string; startDate: string; endDate: string; days: string; status: string; leaveType: { name: string } }[];
  payslips: { id: string; grossPay: string; netPay: string; run: { number: string; periodStart: string; periodEnd: string; status: string } }[];
}

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const { data: e } = useGet<EmployeeDetail>(`/hr/employees/${id}`);
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);

  if (!e) return <Loading />;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {e.firstName} {e.lastName} <StatusBadge status={e.status} />
          </span>
        }
        subtitle={`${e.code}${e.jobTitle ? ` · ${e.jobTitle}` : ''}`}
        back="/hr/employees"
        actions={
          <>
            <Button variant="secondary" onClick={() => setRequesting(true)}>
              <CalendarPlus className="size-4" /> Request leave
            </Button>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
          </>
        }
      />
      <Card>
        <DescriptionList
          items={[
            ['Department', e.department?.name],
            ['Email', e.email],
            ['Phone', e.phone],
            ['Hire date', date(e.hireDate)],
            ['Base salary', money(e.baseSalary)],
            ['Allowances', money(e.allowances)],
            ['Income tax', `${num(e.taxRatePct)}%`],
            ['Bank account', e.bankAccount],
          ]}
        />
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={`Leave balances ${new Date().getFullYear()}`} padded={false}>
          <DataTable
            rows={e.leaveBalances.map((b) => ({ ...b, id: b.leaveTypeId }))}
            columns={[
              { key: 'name', header: 'Type', cell: (b) => b.name },
              { key: 'entitled', header: 'Entitled', align: 'right', cell: (b) => (b.entitled ? b.entitled : '—') },
              { key: 'taken', header: 'Taken', align: 'right', cell: (b) => num(b.taken) },
              { key: 'pending', header: 'Pending', align: 'right', cell: (b) => num(b.pending) },
              { key: 'remaining', header: 'Remaining', align: 'right', cell: (b) => (b.entitled ? <span className="font-medium">{num(b.remaining)}</span> : '—') },
            ]}
          />
        </Card>
        <Card title="Leave history" padded={false}>
          <DataTable
            rows={e.leaveRequests}
            empty="No leave requests"
            columns={[
              { key: 'type', header: 'Type', cell: (l) => l.leaveType.name },
              { key: 'dates', header: 'Dates', cell: (l) => `${date(l.startDate)} – ${date(l.endDate)}` },
              { key: 'days', header: 'Days', align: 'right', cell: (l) => num(l.days) },
              { key: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
            ]}
          />
        </Card>
        <Card title="Payslips" padded={false} className="lg:col-span-2">
          <DataTable
            rows={e.payslips}
            empty="No payslips yet"
            columns={[
              { key: 'run', header: 'Run', cell: (p) => p.run.number },
              { key: 'period', header: 'Period', cell: (p) => `${date(p.run.periodStart)} – ${date(p.run.periodEnd)}` },
              { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.run.status} /> },
              { key: 'gross', header: 'Gross', align: 'right', cell: (p) => money(p.grossPay) },
              { key: 'net', header: 'Net', align: 'right', cell: (p) => money(p.netPay) },
            ]}
          />
        </Card>
      </div>
      {editing && <EmployeeModal employee={e} onClose={() => setEditing(false)} />}
      {requesting && <LeaveRequestModal employeeId={e.id} onClose={() => setRequesting(false)} />}
    </>
  );
}
