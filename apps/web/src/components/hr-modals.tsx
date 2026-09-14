'use client';

import { FormEvent, useState } from 'react';
import { patch, post } from '@/lib/api';
import { humanize, inputDate, today } from '@/lib/format';
import { useAction, useFields, useGet, useOptions } from '@/lib/hooks';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from './ui';

export interface EmployeeRecord {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  hireDate: string;
  terminationDate: string | null;
  status: string;
  baseSalary: string;
  allowances: string;
  taxRatePct: string;
  bankAccount: string | null;
}

export function EmployeeModal({ employee, onClose }: { employee: EmployeeRecord | null; onClose: () => void }) {
  const departments = useOptions<{ id: string; name: string }>('/hr/departments');
  const [f, set] = useFields({
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    jobTitle: employee?.jobTitle ?? '',
    departmentId: employee?.departmentId ?? '',
    hireDate: inputDate(employee?.hireDate) || today(),
    terminationDate: inputDate(employee?.terminationDate),
    status: employee?.status ?? 'ACTIVE',
    baseSalary: String(Number(employee?.baseSalary ?? 0)),
    allowances: String(Number(employee?.allowances ?? 0)),
    taxRatePct: String(Number(employee?.taxRatePct ?? 0)),
    bankAccount: employee?.bankAccount ?? '',
  });
  const save = useAction(
    () => {
      const body = {
        ...f,
        email: f.email || null,
        phone: f.phone || null,
        jobTitle: f.jobTitle || null,
        departmentId: f.departmentId || null,
        terminationDate: f.terminationDate || null,
        bankAccount: f.bankAccount || null,
        baseSalary: Number(f.baseSalary),
        allowances: Number(f.allowances || 0),
        taxRatePct: Number(f.taxRatePct || 0),
      };
      return employee ? patch(`/hr/employees/${employee.id}`, body) : post('/hr/employees', body);
    },
    { success: 'Employee saved', onSuccess: onClose },
  );

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={employee ? `Edit ${employee.firstName} ${employee.lastName}` : 'New employee'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="employee-form"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="First name">
          <Input required value={f.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />
        </Field>
        <Field label="Last name">
          <Input required value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
        <Field label="Job title">
          <Input value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Department">
          <Select value={f.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hire date">
          <Input type="date" required value={f.hireDate} onChange={(e) => set('hireDate', e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
            {['ACTIVE', 'ON_LEAVE', 'TERMINATED'].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Termination date">
          <Input type="date" value={f.terminationDate} onChange={(e) => set('terminationDate', e.target.value)} />
        </Field>
        <Field label="Monthly base salary">
          <Input type="number" min="0" step="0.01" required value={f.baseSalary} onChange={(e) => set('baseSalary', e.target.value)} />
        </Field>
        <Field label="Monthly allowances">
          <Input type="number" min="0" step="0.01" value={f.allowances} onChange={(e) => set('allowances', e.target.value)} />
        </Field>
        <Field label="Income tax %">
          <Input type="number" min="0" max="100" step="0.01" value={f.taxRatePct} onChange={(e) => set('taxRatePct', e.target.value)} />
        </Field>
        <Field label="Bank account" className="sm:col-span-3">
          <Input value={f.bankAccount} onChange={(e) => set('bankAccount', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

export function DepartmentsModal({ onClose }: { onClose: () => void }) {
  const { data } = useGet<{ id: string; name: string; _count: { employees: number } }[]>('/hr/departments');
  const [name, setName] = useState('');
  const add = useAction(() => post('/hr/departments', { name }), { success: 'Department added', onSuccess: () => setName('') });
  return (
    <Modal open size="sm" onClose={onClose} title="Departments">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New department" />
        <Button type="submit" variant="secondary" loading={add.isPending}>
          Add
        </Button>
      </form>
      <ul className="divide-y divide-slate-100 text-sm">
        {data?.map((d) => (
          <li key={d.id} className="flex justify-between py-2">
            <span>{d.name}</span>
            <span className="text-slate-500">{d._count.employees} employees</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function LeaveTypesModal({ onClose }: { onClose: () => void }) {
  const { data } = useGet<{ id: string; name: string; daysPerYear: number; isPaid: boolean }[]>('/hr/leave-types');
  const [f, set, reset] = useFields({ name: '', daysPerYear: '0', isPaid: true });
  const add = useAction(() => post('/hr/leave-types', { ...f, daysPerYear: Number(f.daysPerYear) }), {
    success: 'Leave type added',
    onSuccess: () => reset({ name: '', daysPerYear: '0', isPaid: true }),
  });
  return (
    <Modal open onClose={onClose} title="Leave types">
      <form
        className="mb-4 grid grid-cols-6 items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Name" className="col-span-3">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Days / year" className="col-span-2">
          <Input type="number" min="0" value={f.daysPerYear} onChange={(e) => set('daysPerYear', e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary" loading={add.isPending}>
          Add
        </Button>
        <div className="col-span-6">
          <Checkbox label="Paid leave" checked={f.isPaid} onChange={(v) => set('isPaid', v)} />
        </div>
      </form>
      <ul className="divide-y divide-slate-100 text-sm">
        {data?.map((t) => (
          <li key={t.id} className="flex justify-between py-2">
            <span>{t.name}</span>
            <span className="text-slate-500">
              {t.daysPerYear ? `${t.daysPerYear} days/yr` : 'Unlimited'} · {t.isPaid ? 'Paid' : 'Unpaid'}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function LeaveRequestModal({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) {
  const employees = useOptions<EmployeeRecord>('/hr/employees', { status: 'ACTIVE' });
  const types = useOptions<{ id: string; name: string }>('/hr/leave-types');
  const [f, set] = useFields({ employeeId: employeeId ?? '', leaveTypeId: '', startDate: today(), endDate: today(), reason: '' });
  const save = useAction(() => post('/hr/leave', { ...f, reason: f.reason || null }), { success: 'Leave requested', onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      title="Request leave"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="leave-form" loading={save.isPending}>
            Submit
          </Button>
        </>
      }
    >
      <form
        id="leave-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Employee">
          <Select required value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.firstName} {e.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Leave type">
          <Select required value={f.leaveTypeId} onChange={(e) => set('leaveTypeId', e.target.value)}>
            <option value="">Select…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" required value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" required value={f.endDate} min={f.startDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
        <Field label="Reason" className="col-span-2">
          <Textarea rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
