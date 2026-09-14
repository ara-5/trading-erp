'use client';

import { Building, Plus } from 'lucide-react';
import { useState } from 'react';
import { DepartmentsModal, EmployeeModal, EmployeeRecord } from '@/components/hr-modals';
import { ListPage } from '@/components/list-page';
import { Button, Select, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';
import { useOptions } from '@/lib/hooks';

export default function EmployeesPage() {
  const [editing, setEditing] = useState<EmployeeRecord | null | undefined>(undefined);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const departments = useOptions<{ id: string; name: string }>('/hr/departments');

  return (
    <>
      <ListPage<EmployeeRecord>
        title="Employees"
        endpoint="/hr/employees"
        statuses={['ACTIVE', 'ON_LEAVE', 'TERMINATED']}
        query={{ departmentId: departmentId || undefined }}
        filters={
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="sm:w-48" aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        }
        rowHref={(e) => `/hr/employees/${e.id}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDepartmentsOpen(true)}>
              <Building className="size-4" /> Departments
            </Button>
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" /> New employee
            </Button>
          </>
        }
        columns={[
          { key: 'code', header: 'Code', cell: (e) => <span className="font-mono text-xs">{e.code}</span> },
          {
            key: 'name',
            header: 'Name',
            cell: (e) => (
              <div>
                <p className="font-medium text-slate-900">
                  {e.firstName} {e.lastName}
                </p>
                <p className="text-xs text-slate-500">{e.jobTitle}</p>
              </div>
            ),
          },
          { key: 'dept', header: 'Department', cell: (e) => e.department?.name ?? '—' },
          { key: 'hired', header: 'Hired', cell: (e) => date(e.hireDate) },
          { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
          { key: 'salary', header: 'Monthly pay', align: 'right', cell: (e) => money(Number(e.baseSalary) + Number(e.allowances)) },
        ]}
      />
      {editing !== undefined && <EmployeeModal employee={editing} onClose={() => setEditing(undefined)} />}
      {departmentsOpen && <DepartmentsModal onClose={() => setDepartmentsOpen(false)} />}
    </>
  );
}
