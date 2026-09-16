'use client';

import { Plus } from 'lucide-react';
import { ListPage } from '@/components/list-page';
import { LinkButton, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';

interface PurchaseOrder {
  id: string;
  number: string;
  date: string;
  expectedDate: string | null;
  status: string;
  total: string;
  supplier: { name: string };
  warehouse: { code: string };
}

export default function PurchaseOrdersPage() {
  return (
    <ListPage<PurchaseOrder>
      title="Purchase orders"
      endpoint="/purchasing/orders"
      statuses={['DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']}
      rowHref={(o) => `/purchasing/orders/${o.id}`}
      actions={
        <LinkButton href="/purchasing/orders/new">
          <Plus className="size-4" /> New purchase order
        </LinkButton>
      }
      columns={[
        { key: 'number', header: 'Number', cell: (o) => <span className="font-medium text-slate-900 dark:text-slate-100">{o.number}</span> },
        { key: 'supplier', header: 'Supplier', cell: (o) => o.supplier.name },
        { key: 'date', header: 'Date', cell: (o) => date(o.date) },
        { key: 'expected', header: 'Expected', cell: (o) => date(o.expectedDate) },
        { key: 'wh', header: 'Warehouse', cell: (o) => o.warehouse.code },
        { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
        { key: 'total', header: 'Total', align: 'right', cell: (o) => money(o.total) },
      ]}
    />
  );
}
