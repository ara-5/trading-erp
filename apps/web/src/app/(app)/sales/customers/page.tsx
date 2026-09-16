'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { PartyModal, PartyRecord } from '@/components/modals';
import { Badge, Button } from '@/components/ui';
import { money } from '@/lib/format';

export default function CustomersPage() {
  const [editing, setEditing] = useState<PartyRecord | null | undefined>(undefined);
  return (
    <>
      <ListPage<PartyRecord>
        title="Customers"
        endpoint="/sales/customers"
        searchPlaceholder="Search name, code or email…"
        statuses={[
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All customers' },
        ]}
        allStatusesLabel="Active"
        rowHref={(c) => `/sales/customers/${c.id}`}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> New customer
          </Button>
        }
        columns={[
          { key: 'code', header: 'Code', cell: (c) => <span className="font-mono text-xs">{c.code}</span> },
          { key: 'name', header: 'Name', cell: (c) => <span className="font-medium text-slate-900 dark:text-slate-100">{c.name}</span> },
          { key: 'email', header: 'Email', cell: (c) => c.email ?? '—' },
          { key: 'phone', header: 'Phone', cell: (c) => c.phone ?? '—' },
          { key: 'terms', header: 'Terms', cell: (c) => `${c.paymentTermsDays} days` },
          { key: 'limit', header: 'Credit limit', align: 'right', cell: (c) => (Number(c.creditLimit) > 0 ? money(c.creditLimit) : '—') },
          { key: 'status', header: '', cell: (c) => !c.isActive && <Badge>Inactive</Badge> },
        ]}
      />
      {editing !== undefined && <PartyModal kind="customer" party={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
