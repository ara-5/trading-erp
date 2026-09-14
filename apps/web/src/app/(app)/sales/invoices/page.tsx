'use client';

import { Plus } from 'lucide-react';
import { ListPage } from '@/components/list-page';
import { LinkButton, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';

interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  status: string;
  total: string;
  amountPaid: string;
  customer: { name: string };
}

export default function InvoicesPage() {
  return (
    <ListPage<Invoice>
      title="Invoices"
      endpoint="/sales/invoices"
      statuses={['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID']}
      rowHref={(i) => `/sales/invoices/${i.id}`}
      actions={
        <LinkButton href="/sales/invoices/new">
          <Plus className="size-4" /> New invoice
        </LinkButton>
      }
      columns={[
        { key: 'number', header: 'Number', cell: (i) => <span className="font-medium text-slate-900">{i.number}</span> },
        { key: 'customer', header: 'Customer', cell: (i) => i.customer.name },
        { key: 'date', header: 'Date', cell: (i) => date(i.date) },
        {
          key: 'due',
          header: 'Due',
          cell: (i) => {
            const overdue = ['POSTED', 'PARTIALLY_PAID'].includes(i.status) && new Date(i.dueDate) < new Date();
            return <span className={overdue ? 'font-medium text-rose-600' : ''}>{date(i.dueDate)}</span>;
          },
        },
        { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
        { key: 'total', header: 'Total', align: 'right', cell: (i) => money(i.total) },
        { key: 'balance', header: 'Balance', align: 'right', cell: (i) => (i.status === 'VOID' ? '—' : money(Number(i.total) - Number(i.amountPaid))) },
      ]}
    />
  );
}
