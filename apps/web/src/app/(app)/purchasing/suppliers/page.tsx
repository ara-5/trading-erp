'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { PartyModal, PartyRecord } from '@/components/modals';
import { Badge, Button } from '@/components/ui';

export default function SuppliersPage() {
  const [editing, setEditing] = useState<PartyRecord | null | undefined>(undefined);
  return (
    <>
      <ListPage<PartyRecord>
        title="Suppliers"
        endpoint="/purchasing/suppliers"
        searchPlaceholder="Search name, code or email…"
        statuses={[
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All suppliers' },
        ]}
        allStatusesLabel="Active"
        rowHref={(s) => `/purchasing/suppliers/${s.id}`}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> New supplier
          </Button>
        }
        columns={[
          { key: 'code', header: 'Code', cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
          { key: 'name', header: 'Name', cell: (s) => <span className="font-medium text-slate-900">{s.name}</span> },
          { key: 'email', header: 'Email', cell: (s) => s.email ?? '—' },
          { key: 'phone', header: 'Phone', cell: (s) => s.phone ?? '—' },
          { key: 'terms', header: 'Terms', cell: (s) => `${s.paymentTermsDays} days` },
          { key: 'status', header: '', cell: (s) => !s.isActive && <Badge>Inactive</Badge> },
        ]}
      />
      {editing !== undefined && <PartyModal kind="supplier" party={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
