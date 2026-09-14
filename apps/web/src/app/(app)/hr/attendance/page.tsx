'use client';

import { CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { EmployeeRecord } from '@/components/hr-modals';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { put } from '@/lib/api';
import { humanize, today } from '@/lib/format';
import { useAction, useGet, useOptions } from '@/lib/hooks';

interface Attendance {
  id: string;
  employeeId: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  notes: string | null;
}

const STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE'];
const toTime = (v: string | null) => (v ? new Date(v).toTimeString().slice(0, 5) : '');

export default function AttendancePage() {
  const [day, setDay] = useState(today());
  const employees = useOptions<EmployeeRecord>('/hr/employees', { status: 'ACTIVE' });
  const { data: records } = useGet<Attendance[]>('/hr/attendance', { from: day, to: day });

  const markAll = useAction(
    async () => {
      const recorded = new Set(records?.map((r) => r.employeeId));
      for (const e of employees.filter((x) => !recorded.has(x.id))) {
        await put('/hr/attendance', { employeeId: e.id, date: day, status: 'PRESENT' });
      }
    },
    { success: 'Remaining employees marked present' },
  );

  const present = records?.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length ?? 0;

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`${present} of ${employees.length} present`}
        actions={
          <>
            <Field label="Date">
              <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Button className="self-end" loading={markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck className="size-4" /> Mark rest present
            </Button>
          </>
        }
      />
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Employee</th>
                <th className="px-4 py-2.5 text-left">Status</th>
                <th className="px-4 py-2.5 text-left">Check in</th>
                <th className="px-4 py-2.5 text-left">Check out</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((e) => {
                const record = records?.find((r) => r.employeeId === e.id);
                return <AttendanceRow key={`${e.id}-${day}-${record?.id ?? 'none'}-${record?.status}`} employee={e} day={day} record={record} />;
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function AttendanceRow({ employee, day, record }: { employee: EmployeeRecord; day: string; record?: Attendance }) {
  const [status, setStatus] = useState(record?.status ?? '');
  const [checkIn, setCheckIn] = useState(toTime(record?.checkIn ?? null));
  const [checkOut, setCheckOut] = useState(toTime(record?.checkOut ?? null));
  const dirty = status !== (record?.status ?? '') || checkIn !== toTime(record?.checkIn ?? null) || checkOut !== toTime(record?.checkOut ?? null);

  const save = useAction(
    () =>
      put('/hr/attendance', {
        employeeId: employee.id,
        date: day,
        status,
        checkIn: checkIn ? new Date(`${day}T${checkIn}:00`).toISOString() : null,
        checkOut: checkOut ? new Date(`${day}T${checkOut}:00`).toISOString() : null,
      }),
    { success: `Saved ${employee.firstName}` },
  );

  return (
    <tr>
      <td className="px-4 py-2">
        <p className="font-medium text-slate-900">
          {employee.firstName} {employee.lastName}
        </p>
        <p className="text-xs text-slate-500">{employee.jobTitle}</p>
      </td>
      <td className="px-4 py-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
          <option value="">Not recorded</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-4 py-2">
        <Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="h-8 w-32" />
      </td>
      <td className="px-4 py-2">
        <Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="h-8 w-32" />
      </td>
      <td className="px-4 py-2 text-right">
        <Button size="sm" variant={dirty ? 'primary' : 'ghost'} disabled={!dirty || !status} loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </td>
    </tr>
  );
}
