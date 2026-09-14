'use client';

import { Plus } from 'lucide-react';
import { ListPage } from '@/components/list-page';
import { LinkButton, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';

interface Bill {
  id: string;
  number: string;
  supplierRef: string | null;
  date: string;
  dueDate: string;
  status: string;
  total: string;
  amountPaid: string;
  supplier: { name: string };
}

export default function BillsPage() {
  return (
    <ListPage<Bill>
      title="Bills"
      subtitle="Supplier invoices and expenses"
      endpoint="/purchasing/bills"
      statuses={['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID']}
      rowHref={(b) => `/purchasing/bills/${b.id}`}
      actions={
        <LinkButton href="/purchasing/bills/new">
          <Plus className="size-4" /> New bill
        </LinkButton>
      }
      columns={[
        { key: 'number', header: 'Number', cell: (b) => <span className="font-medium text-slate-900">{b.number}</span> },
        { key: 'supplier', header: 'Supplier', cell: (b) => b.supplier.name },
        { key: 'ref', header: 'Supplier ref', cell: (b) => b.supplierRef ?? '—' },
        { key: 'date', header: 'Date', cell: (b) => date(b.date) },
        {
          key: 'due',
          header: 'Due',
          cell: (b) => {
            const overdue = ['POSTED', 'PARTIALLY_PAID'].includes(b.status) && new Date(b.dueDate) < new Date();
            return <span className={overdue ? 'font-medium text-rose-600' : ''}>{date(b.dueDate)}</span>;
          },
        },
        { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
        { key: 'total', header: 'Total', align: 'right', cell: (b) => money(b.total) },
        { key: 'balance', header: 'Balance', align: 'right', cell: (b) => (b.status === 'VOID' ? '—' : money(Number(b.total) - Number(b.amountPaid))) },
      ]}
    />
  );
}
