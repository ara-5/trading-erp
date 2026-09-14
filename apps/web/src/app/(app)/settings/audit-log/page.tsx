'use client';

import { ListPage } from '@/components/list-page';
import { Badge } from '@/components/ui';
import { dateTime } from '@/lib/format';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  data: unknown;
  createdAt: string;
  user: { name: string; email: string } | null;
}

export default function AuditLogPage() {
  return (
    <ListPage<AuditEntry>
      title="Audit log"
      subtitle="Who changed what, and when"
      endpoint="/admin/audit-log"
      searchPlaceholder="Filter by entity (e.g. SalesInvoice)…"
      columns={[
        { key: 'time', header: 'Time', cell: (a) => dateTime(a.createdAt) },
        { key: 'user', header: 'User', cell: (a) => a.user?.name ?? 'System' },
        { key: 'action', header: 'Action', cell: (a) => <Badge tone="blue">{a.action}</Badge> },
        { key: 'entity', header: 'Entity', cell: (a) => <span className="font-medium text-slate-900">{a.entity}</span> },
        { key: 'id', header: 'Record', cell: (a) => <span className="font-mono text-xs text-slate-500">{a.entityId ?? '—'}</span> },
        {
          key: 'data',
          header: 'Details',
          className: 'max-w-sm truncate',
          cell: (a) => (a.data ? <span className="font-mono text-xs text-slate-500" title={JSON.stringify(a.data, null, 2)}>{JSON.stringify(a.data)}</span> : ''),
        },
      ]}
    />
  );
}
