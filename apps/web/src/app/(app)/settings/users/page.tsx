'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { Badge, Button, Checkbox, Field, Input, Modal, Select } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { date, humanize } from '@/lib/format';
import { useAction, useFields } from '@/lib/hooks';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const ROLES = ['ADMIN', 'ACCOUNTANT', 'SALES', 'PURCHASING', 'INVENTORY', 'HR', 'VIEWER'];

export default function UsersPage() {
  const [editing, setEditing] = useState<UserRow | null | undefined>(undefined);
  return (
    <>
      <ListPage<UserRow>
        title="Users"
        subtitle="Roles control which modules each person can use"
        endpoint="/admin/users"
        onRowClick={setEditing}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> Invite user
          </Button>
        }
        columns={[
          { key: 'name', header: 'Name', cell: (u) => <span className="font-medium text-slate-900">{u.name}</span> },
          { key: 'email', header: 'Email', cell: (u) => u.email },
          { key: 'role', header: 'Role', cell: (u) => <Badge tone={u.role === 'ADMIN' ? 'purple' : 'blue'}>{humanize(u.role)}</Badge> },
          { key: 'status', header: 'Status', cell: (u) => (u.isActive ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>) },
          { key: 'created', header: 'Created', cell: (u) => date(u.createdAt) },
        ]}
      />
      {editing !== undefined && <UserModal user={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function UserModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [f, set] = useFields({ email: user?.email ?? '', name: user?.name ?? '', role: user?.role ?? 'VIEWER', password: '', isActive: user?.isActive ?? true });
  const save = useAction(
    () =>
      user
        ? patch(`/admin/users/${user.id}`, { name: f.name, role: f.role, isActive: f.isActive, ...(f.password ? { password: f.password } : {}) })
        : post('/admin/users', { email: f.email, name: f.name, role: f.role, password: f.password }),
    { success: 'User saved', onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `Edit ${user.name}` : 'New user'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="user-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Email">
          <Input type="email" required disabled={!!user} value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {humanize(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={user ? 'New password' : 'Password'} hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" minLength={8} required={!user} value={f.password} onChange={(e) => set('password', e.target.value)} />
        </Field>
        {user && <Checkbox label="Active" checked={f.isActive} onChange={(v) => set('isActive', v)} />}
      </form>
    </Modal>
  );
}
