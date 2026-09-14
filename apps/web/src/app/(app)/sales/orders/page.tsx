'use client';

import { Plus } from 'lucide-react';
import { ListPage } from '@/components/list-page';
import { LinkButton, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';

interface Order {
  id: string;
  number: string;
  date: string;
  status: string;
  total: string;
  customer: { name: string };
  warehouse: { code: string };
}

export default function SalesOrdersPage() {
  return (
    <ListPage<Order>
      title="Sales orders"
      endpoint="/sales/orders"
      statuses={['DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED']}
      rowHref={(o) => `/sales/orders/${o.id}`}
      actions={
        <LinkButton href="/sales/orders/new">
          <Plus className="size-4" /> New order
        </LinkButton>
      }
      columns={[
        { key: 'number', header: 'Number', cell: (o) => <span className="font-medium text-slate-900">{o.number}</span> },
        { key: 'customer', header: 'Customer', cell: (o) => o.customer.name },
        { key: 'date', header: 'Date', cell: (o) => date(o.date) },
        { key: 'wh', header: 'Warehouse', cell: (o) => o.warehouse.code },
        { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
        { key: 'total', header: 'Total', align: 'right', cell: (o) => money(o.total) },
      ]}
    />
  );
}
