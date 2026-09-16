'use client';

import { Ban, BookCheck, Pencil, Printer, Trash2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LinesTable, Totals } from '@/components/line-items';
import { PaymentModal } from '@/components/modals';
import { Button, Card, ConfirmButton, DataTable, DescriptionList, LinkButton, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date, humanize, money } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';
import type { InvoiceDetail } from '@/lib/types';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: inv } = useGet<InvoiceDetail>(`/sales/invoices/${id}`);
  const [paying, setPaying] = useState(false);

  const postInv = useAction(() => post(`/sales/invoices/${id}/post`), { success: 'Invoice posted to the ledger' });
  const voidInv = useAction(() => post<{ deleted?: boolean }>(`/sales/invoices/${id}/void`), {
    success: 'Done',
    onSuccess: (r) => r.deleted && router.push('/sales/invoices'),
  });

  if (!inv) return <Loading />;
  const outstanding = Number(inv.total) - Number(inv.amountPaid);
  const overdue = ['POSTED', 'PARTIALLY_PAID'].includes(inv.status) && new Date(inv.dueDate) < new Date();

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {inv.number} <StatusBadge status={inv.status} />
            {overdue && <span className="text-xs font-medium text-rose-600">Overdue</span>}
          </span>
        }
        subtitle={inv.customer.name}
        back="/sales/invoices"
        actions={
          <>
            <Button variant="ghost" onClick={() => window.print()} aria-label="Print">
              <Printer className="size-4" />
            </Button>
            {inv.status === 'DRAFT' && (
              <>
                <ConfirmButton variant="danger" message="Delete this draft invoice?" onConfirm={() => voidInv.mutate()}>
                  <Trash2 className="size-4" /> Delete
                </ConfirmButton>
                <LinkButton variant="secondary" href={`/sales/invoices/${id}/edit`}>
                  <Pencil className="size-4" /> Edit
                </LinkButton>
                <Button loading={postInv.isPending} onClick={() => postInv.mutate()}>
                  <BookCheck className="size-4" /> Post
                </Button>
              </>
            )}
            {inv.status === 'POSTED' && (
              <ConfirmButton variant="danger" message="Void this invoice? Its journal entry will be voided." loading={voidInv.isPending} onConfirm={() => voidInv.mutate()}>
                <Ban className="size-4" /> Void
              </ConfirmButton>
            )}
            {(inv.status === 'POSTED' || inv.status === 'PARTIALLY_PAID') && (
              <Button onClick={() => setPaying(true)}>
                <Wallet className="size-4" /> Record payment
              </Button>
            )}
          </>
        }
      />

      <Card>
        <DescriptionList
          items={[
            ['Customer', <Link key="c" href={`/sales/customers/${inv.customer.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{inv.customer.name}</Link>],
            ['Invoice date', date(inv.date)],
            ['Due date', date(inv.dueDate)],
            ['Sales order', inv.salesOrder ? <Link key="so" href={`/sales/orders/${inv.salesOrder.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{inv.salesOrder.number}</Link> : '—'],
            ['Tax number', inv.customer.taxNumber],
            ['Billing address', inv.customer.address],
            ['Balance due', <span key="b" className="font-semibold">{money(outstanding)}</span>],
          ]}
        />
      </Card>

      <Card title="Lines" className="mt-4" padded={false}>
        <LinesTable lines={inv.lines} />
        <div className="flex justify-end border-t border-slate-100 dark:border-slate-800 p-4">
          <Totals subtotal={inv.subtotal} taxTotal={inv.taxTotal} total={inv.total} amountPaid={inv.status === 'DRAFT' ? undefined : inv.amountPaid} />
        </div>
      </Card>

      {inv.payments.length > 0 && (
        <Card title="Payments" className="mt-4" padded={false}>
          <DataTable
            rows={inv.payments}
            columns={[
              { key: 'number', header: 'Receipt', cell: (p) => <span className="font-medium text-slate-900 dark:text-slate-100">{p.number}</span> },
              { key: 'date', header: 'Date', cell: (p) => date(p.date) },
              { key: 'method', header: 'Method', cell: (p) => humanize(p.method) },
              { key: 'ref', header: 'Reference', cell: (p) => p.reference ?? '—' },
              { key: 'amount', header: 'Amount', align: 'right', cell: (p) => money(p.amount) },
            ]}
          />
        </Card>
      )}

      {inv.notes && (
        <Card title="Notes" className="mt-4">
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{inv.notes}</p>
        </Card>
      )}

      {paying && (
        <PaymentModal
          direction="RECEIVED"
          partyId={inv.customerId}
          doc={{ id: inv.id, number: inv.number, outstanding, kind: 'invoice' }}
          onClose={() => setPaying(false)}
        />
      )}
    </>
  );
}
