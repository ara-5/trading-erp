'use client';

import { Ban, CheckCircle2, FileText, Pencil, Truck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LinesTable, Totals } from '@/components/line-items';
import { FulfilModal } from '@/components/modals';
import { Button, Card, ConfirmButton, DescriptionList, LinkButton, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';
import type { SalesOrderDetail } from '@/lib/types';

export default function SalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: so } = useGet<SalesOrderDetail>(`/sales/orders/${id}`);
  const [delivering, setDelivering] = useState(false);

  const confirm = useAction(() => post(`/sales/orders/${id}/confirm`), { success: 'Order confirmed' });
  const cancel = useAction(() => post(`/sales/orders/${id}/cancel`), { success: 'Order cancelled' });
  const deliver = useAction((body: { date: string; lines: { lineId: string; quantity: number }[] }) => post(`/sales/orders/${id}/deliver`, body), {
    success: 'Delivery recorded',
    onSuccess: () => setDelivering(false),
  });
  const invoice = useAction(() => post<{ id: string }>(`/sales/orders/${id}/invoice`), {
    success: 'Draft invoice created',
    onSuccess: (inv) => router.push(`/sales/invoices/${inv.id}`),
  });

  if (!so) return <Loading />;
  const active = so.status === 'CONFIRMED' || so.status === 'PARTIALLY_DELIVERED';
  const invoiceable = so.lines.some((l) => (l.product.trackInventory ? Number(l.deliveredQty) : Number(l.quantity)) > Number(l.invoicedQty));
  const canInvoice = so.status !== 'DRAFT' && so.status !== 'CANCELLED' && invoiceable;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {so.number} <StatusBadge status={so.status} />
          </span>
        }
        subtitle={so.customer.name}
        back="/sales/orders"
        actions={
          <>
            {so.status === 'DRAFT' && (
              <>
                <LinkButton variant="secondary" href={`/sales/orders/${id}/edit`}>
                  <Pencil className="size-4" /> Edit
                </LinkButton>
                <Button loading={confirm.isPending} onClick={() => confirm.mutate()}>
                  <CheckCircle2 className="size-4" /> Confirm
                </Button>
              </>
            )}
            {(so.status === 'DRAFT' || so.status === 'CONFIRMED') && (
              <ConfirmButton variant="danger" message="Cancel this order?" loading={cancel.isPending} onConfirm={() => cancel.mutate()}>
                <Ban className="size-4" /> Cancel
              </ConfirmButton>
            )}
            {active && (
              <Button variant={canInvoice ? 'secondary' : 'primary'} onClick={() => setDelivering(true)}>
                <Truck className="size-4" /> Deliver
              </Button>
            )}
            {canInvoice && (
              <Button loading={invoice.isPending} onClick={() => invoice.mutate()}>
                <FileText className="size-4" /> Create invoice
              </Button>
            )}
          </>
        }
      />

      <Card>
        <DescriptionList
          items={[
            ['Customer', <Link key="c" href={`/sales/customers/${so.customer.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{so.customer.name}</Link>],
            ['Date', date(so.date)],
            ['Warehouse', `${so.warehouse.code} · ${so.warehouse.name}`],
            ['From quotation', so.quotation ? <Link key="q" href={`/sales/quotations/${so.quotation.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{so.quotation.number}</Link> : '—'],
          ]}
        />
      </Card>

      <Card title="Lines" className="mt-4" padded={false}>
        <LinesTable
          lines={so.lines}
          progress={[
            { key: 'deliveredQty', label: 'Delivered' },
            { key: 'invoicedQty', label: 'Invoiced' },
          ]}
        />
        <div className="flex justify-end border-t border-slate-100 dark:border-slate-800 p-4">
          <Totals subtotal={so.subtotal} taxTotal={so.taxTotal} total={so.total} />
        </div>
      </Card>

      {so.invoices.length > 0 && (
        <Card title="Invoices" className="mt-4">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {so.invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-2">
                <Link href={`/sales/invoices/${inv.id}`} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                  {inv.number}
                </Link>
                <span className="flex items-center gap-3">
                  <StatusBadge status={inv.status} />
                  <span className="tabular">{money(inv.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {delivering && (
        <FulfilModal
          title={`Deliver ${so.number}`}
          action="Record delivery"
          pending={deliver.isPending}
          onClose={() => setDelivering(false)}
          onSubmit={(body) => deliver.mutate(body)}
          lines={so.lines.map((l) => ({
            id: l.id,
            label: `${l.product.sku} · ${l.description ?? l.product.name}`,
            remaining: Number(l.quantity) - Number(l.deliveredQty),
            uom: l.product.uom,
          }))}
        />
      )}
    </>
  );
}
