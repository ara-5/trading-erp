'use client';

import { Ban, CheckCircle2, PackageCheck, Pencil, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LinesTable, Totals } from '@/components/line-items';
import { FulfilModal } from '@/components/modals';
import { Button, Card, ConfirmButton, DescriptionList, LinkButton, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';
import type { PurchaseOrderDetail } from '@/lib/types';

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: po } = useGet<PurchaseOrderDetail>(`/purchasing/orders/${id}`);
  const [receiving, setReceiving] = useState(false);

  const approve = useAction(() => post(`/purchasing/orders/${id}/approve`), { success: 'Purchase order approved' });
  const cancel = useAction(() => post(`/purchasing/orders/${id}/cancel`), { success: 'Purchase order cancelled' });
  const receive = useAction((body: { date: string; lines: { lineId: string; quantity: number }[] }) => post(`/purchasing/orders/${id}/receive`, body), {
    success: 'Goods received into stock',
    onSuccess: () => setReceiving(false),
  });
  const bill = useAction(() => post<{ id: string }>(`/purchasing/orders/${id}/bill`), {
    success: 'Draft bill created',
    onSuccess: (b) => router.push(`/purchasing/bills/${b.id}`),
  });

  if (!po) return <Loading />;
  const receivable = po.status === 'APPROVED' || po.status === 'PARTIALLY_RECEIVED';
  const billable = po.lines.some((l) => Number(l.receivedQty) > Number(l.billedQty));
  const nothingReceived = po.lines.every((l) => Number(l.receivedQty) === 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {po.number} <StatusBadge status={po.status} />
          </span>
        }
        subtitle={po.supplier.name}
        back="/purchasing/orders"
        actions={
          <>
            {po.status === 'DRAFT' && (
              <>
                <LinkButton variant="secondary" href={`/purchasing/orders/${id}/edit`}>
                  <Pencil className="size-4" /> Edit
                </LinkButton>
                <Button loading={approve.isPending} onClick={() => approve.mutate()}>
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
              </>
            )}
            {(po.status === 'DRAFT' || po.status === 'APPROVED') && nothingReceived && (
              <ConfirmButton variant="danger" message="Cancel this purchase order?" loading={cancel.isPending} onConfirm={() => cancel.mutate()}>
                <Ban className="size-4" /> Cancel
              </ConfirmButton>
            )}
            {receivable && (
              <Button variant={billable ? 'secondary' : 'primary'} onClick={() => setReceiving(true)}>
                <PackageCheck className="size-4" /> Receive goods
              </Button>
            )}
            {billable && (
              <Button loading={bill.isPending} onClick={() => bill.mutate()}>
                <ScrollText className="size-4" /> Create bill
              </Button>
            )}
          </>
        }
      />

      <Card>
        <DescriptionList
          items={[
            ['Supplier', <Link key="s" href={`/purchasing/suppliers/${po.supplier.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{po.supplier.name}</Link>],
            ['Order date', date(po.date)],
            ['Expected', date(po.expectedDate)],
            ['Deliver to', `${po.warehouse.code} · ${po.warehouse.name}`],
          ]}
        />
      </Card>

      <Card title="Lines" className="mt-4" padded={false}>
        <LinesTable
          lines={po.lines}
          progress={[
            { key: 'receivedQty', label: 'Received' },
            { key: 'billedQty', label: 'Billed' },
          ]}
        />
        <div className="flex justify-end border-t border-slate-100 dark:border-slate-800 p-4">
          <Totals subtotal={po.subtotal} taxTotal={po.taxTotal} total={po.total} />
        </div>
      </Card>

      {po.bills.length > 0 && (
        <Card title="Bills" className="mt-4">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {po.bills.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <Link href={`/purchasing/bills/${b.id}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                  {b.number}
                </Link>
                <span className="flex items-center gap-3">
                  <StatusBadge status={b.status} />
                  <span className="tabular">{money(b.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {po.notes && (
        <Card title="Notes" className="mt-4">
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{po.notes}</p>
        </Card>
      )}

      {receiving && (
        <FulfilModal
          title={`Receive ${po.number}`}
          action="Receive into stock"
          pending={receive.isPending}
          onClose={() => setReceiving(false)}
          onSubmit={(body) => receive.mutate(body)}
          lines={po.lines.map((l) => ({
            id: l.id,
            label: `${l.product.sku} · ${l.description ?? l.product.name}`,
            remaining: Number(l.quantity) - Number(l.receivedQty),
            uom: l.product.uom,
          }))}
        />
      )}
    </>
  );
}
