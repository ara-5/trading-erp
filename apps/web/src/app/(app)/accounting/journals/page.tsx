'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { LinkButton, Select, StatusBadge } from '@/components/ui';
import { date, humanize, money } from '@/lib/format';

interface Entry {
  id: string;
  number: string;
  date: string;
  description: string;
  reference: string | null;
  status: string;
  sourceType: string;
  amount: string;
}

const SOURCES = ['MANUAL', 'SALES_INVOICE', 'PURCHASE_BILL', 'PAYMENT', 'PAYROLL', 'STOCK'];

export default function JournalsPage() {
  const [sourceType, setSourceType] = useState('');
  return (
    <ListPage<Entry>
      title="Journal entries"
      subtitle="The general ledger — automatic postings and manual journals"
      endpoint="/accounting/journals"
      statuses={['DRAFT', 'POSTED', 'VOID']}
      query={{ sourceType: sourceType || undefined }}
      filters={
        <Select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="sm:w-48" aria-label="Source">
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </Select>
      }
      rowHref={(e) => `/accounting/journals/${e.id}`}
      actions={
        <LinkButton href="/accounting/journals/new">
          <Plus className="size-4" /> Manual journal
        </LinkButton>
      }
      columns={[
        { key: 'number', header: 'Number', cell: (e) => <span className="font-medium text-slate-900">{e.number}</span> },
        { key: 'date', header: 'Date', cell: (e) => date(e.date) },
        { key: 'desc', header: 'Description', className: 'max-w-md truncate', cell: (e) => e.description },
        { key: 'source', header: 'Source', cell: (e) => humanize(e.sourceType) },
        { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
        { key: 'amount', header: 'Amount', align: 'right', cell: (e) => money(e.amount) },
      ]}
    />
  );
}
