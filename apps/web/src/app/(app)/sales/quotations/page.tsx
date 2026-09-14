'use client';

import { Plus } from 'lucide-react';
import { ListPage } from '@/components/list-page';
import { LinkButton, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';

interface Quotation {
  id: string;
  number: string;
  date: string;
  validUntil: string | null;
  status: string;
  total: string;
  customer: { name: string };
}

export default function QuotationsPage() {
  return (
    <ListPage<Quotation>
      title="Quotations"
      endpoint="/sales/quotations"
      statuses={['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED']}
      rowHref={(q) => `/sales/quotations/${q.id}`}
      actions={
        <LinkButton href="/sales/quotations/new">
          <Plus className="size-4" /> New quotation
        </LinkButton>
      }
      columns={[
        { key: 'number', header: 'Number', cell: (q) => <span className="font-medium text-slate-900">{q.number}</span> },
        { key: 'customer', header: 'Customer', cell: (q) => q.customer.name },
        { key: 'date', header: 'Date', cell: (q) => date(q.date) },
        { key: 'valid', header: 'Valid until', cell: (q) => date(q.validUntil) },
        { key: 'status', header: 'Status', cell: (q) => <StatusBadge status={q.status} /> },
        { key: 'total', header: 'Total', align: 'right', cell: (q) => money(q.total) },
      ]}
    />
  );
}
