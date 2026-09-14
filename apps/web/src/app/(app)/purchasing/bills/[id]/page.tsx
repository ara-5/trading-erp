'use client';

import { Ban, BookCheck, Pencil, Trash2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LinesTable, Totals } from '@/components/line-items';
import { PaymentModal } from '@/components/modals';
import { Button, Card, ConfirmButton, DataTable, DescriptionList, LinkButton, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date, humanize, money } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';
import type { BillDetail } from '@/lib/types';

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: bill } = useGet<BillDetail>(`/purchasing/bills/${id}`);
  const [paying, setPaying] = useState(false);

  const postBill = useAction(() => post(`/purchasing/bills/${id}/post`), { success: 'Bill posted to the ledger' });
  const voidBill = useAction(() => post<{ deleted?: boolean }>(`/purchasing/bills/${id}/void`), {
    success: 'Done',
    onSuccess: (r) => r.deleted && router.push('/purchasing/bills'),
  });

  if (!bill) return <Loading />;
  const outstanding = Number(bill.total) - Number(bill.amountPaid);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {bill.number} <StatusBadge status={bill.status} />
          </span>
        }
        subtitle={bill.supplier.name}
        back="/purchasing/bills"
        actions={
          <>
            {bill.status === 'DRAFT' && (
              <>
                <ConfirmButton variant="danger" message="Delete this draft bill?" onConfirm={() => voidBill.mutate()}>
                  <Trash2 className="size-4" /> Delete
                </ConfirmButton>
                <LinkButton variant="secondary" href={`/purchasing/bills/${id}/edit`}>
                  <Pencil className="size-4" /> Edit
                </LinkButton>
                <Button loading={postBill.isPending} onClick={() => postBill.mutate()}>
                  <BookCheck className="size-4" /> Post
                </Button>
              </>
            )}
            {bill.status === 'POSTED' && (
              <ConfirmButton variant="danger" message="Void this bill? Its journal entry will be voided." loading={voidBill.isPending} onConfirm={() => voidBill.mutate()}>
                <Ban className="size-4" /> Void
              </ConfirmButton>
            )}
            {(bill.status === 'POSTED' || bill.status === 'PARTIALLY_PAID') && (
              <Button onClick={() => setPaying(true)}>
                <Wallet className="size-4" /> Pay bill
              </Button>
            )}
          </>
        }
      />

      <Card>
        <DescriptionList
          items={[
            ['Supplier', <Link key="s" href={`/purchasing/suppliers/${bill.supplier.id}`} className="text-indigo-600 hover:underline">{bill.supplier.name}</Link>],
            ['Supplier invoice #', bill.supplierRef],
            ['Bill date', date(bill.date)],
            ['Due date', date(bill.dueDate)],
            ['Purchase order', bill.purchaseOrder ? <Link key="po" href={`/purchasing/orders/${bill.purchaseOrder.id}`} className="text-indigo-600 hover:underline">{bill.purchaseOrder.number}</Link> : '—'],
            ['Balance due', <span key="b" className="font-semibold">{money(outstanding)}</span>],
          ]}
        />
      </Card>

      <Card title="Lines" className="mt-4" padded={false}>
        <LinesTable lines={bill.lines} />
        <div className="flex justify-end border-t border-slate-100 p-4">
          <Totals subtotal={bill.subtotal} taxTotal={bill.taxTotal} total={bill.total} amountPaid={bill.status === 'DRAFT' ? undefined : bill.amountPaid} />
        </div>
      </Card>

      {bill.payments.length > 0 && (
        <Card title="Payments" className="mt-4" padded={false}>
          <DataTable
            rows={bill.payments}
            columns={[
              { key: 'number', header: 'Payment', cell: (p) => <span className="font-medium text-slate-900">{p.number}</span> },
              { key: 'date', header: 'Date', cell: (p) => date(p.date) },
              { key: 'method', header: 'Method', cell: (p) => humanize(p.method) },
              { key: 'ref', header: 'Reference', cell: (p) => p.reference ?? '—' },
              { key: 'amount', header: 'Amount', align: 'right', cell: (p) => money(p.amount) },
            ]}
          />
        </Card>
      )}

      {paying && (
        <PaymentModal direction="PAID" partyId={bill.supplierId} doc={{ id: bill.id, number: bill.number, outstanding, kind: 'bill' }} onClose={() => setPaying(false)} />
      )}
    </>
  );
}
