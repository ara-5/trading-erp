'use client';

import { ArrowRightLeft, Check, Pencil, Printer, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { EntitySelect } from '@/components/list-page';
import { LinesTable, Totals } from '@/components/line-items';
import { Button, Card, DescriptionList, Field, LinkButton, Loading, Modal, PageHeader, StatusBadge } from '@/components/ui';
import { post } from '@/lib/api';
import { date } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';
import type { QuotationDetail } from '@/lib/types';

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: q } = useGet<QuotationDetail>(`/sales/quotations/${id}`);
  const [converting, setConverting] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');

  const send = useAction(() => post(`/sales/quotations/${id}/send`), { success: 'Marked as sent' });
  const accept = useAction(() => post(`/sales/quotations/${id}/accept`), { success: 'Quotation accepted' });
  const reject = useAction(() => post(`/sales/quotations/${id}/reject`), { success: 'Quotation rejected' });
  const convert = useAction(() => post<{ id: string }>(`/sales/quotations/${id}/convert`, { warehouseId }), {
    success: 'Sales order created',
    onSuccess: (so) => router.push(`/sales/orders/${so.id}`),
  });

  if (!q) return <Loading />;
  const open = q.status === 'DRAFT' || q.status === 'SENT';

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {q.number} <StatusBadge status={q.status} />
          </span>
        }
        subtitle={q.customer.name}
        back="/sales/quotations"
        actions={
          <>
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer className="size-4" />
            </Button>
            {open && (
              <LinkButton variant="secondary" href={`/sales/quotations/${id}/edit`}>
                <Pencil className="size-4" /> Edit
              </LinkButton>
            )}
            {q.status === 'DRAFT' && (
              <Button variant="secondary" loading={send.isPending} onClick={() => send.mutate()}>
                <Send className="size-4" /> Mark sent
              </Button>
            )}
            {open && (
              <>
                <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}>
                  <X className="size-4" /> Reject
                </Button>
                <Button variant="secondary" loading={accept.isPending} onClick={() => accept.mutate()}>
                  <Check className="size-4" /> Accept
                </Button>
              </>
            )}
            {(open || q.status === 'ACCEPTED') && (
              <Button onClick={() => setConverting(true)}>
                <ArrowRightLeft className="size-4" /> Convert to order
              </Button>
            )}
          </>
        }
      />

      <Card>
        <DescriptionList
          items={[
            ['Customer', <Link key="c" href={`/sales/customers/${q.customer.id}`} className="text-indigo-600 hover:underline">{q.customer.name}</Link>],
            ['Date', date(q.date)],
            ['Valid until', date(q.validUntil)],
            ['Sales orders', q.salesOrders.length ? q.salesOrders.map((so) => <Link key={so.id} href={`/sales/orders/${so.id}`} className="mr-2 text-indigo-600 hover:underline">{so.number}</Link>) : '—'],
          ]}
        />
      </Card>

      <Card title="Lines" className="mt-4" padded={false}>
        <LinesTable lines={q.lines} />
        <div className="flex justify-end border-t border-slate-100 p-4">
          <Totals subtotal={q.subtotal} taxTotal={q.taxTotal} total={q.total} />
        </div>
      </Card>
      {q.notes && (
        <Card title="Notes" className="mt-4">
          <p className="whitespace-pre-wrap text-sm text-slate-700">{q.notes}</p>
        </Card>
      )}

      {converting && (
        <Modal
          open
          size="sm"
          onClose={() => setConverting(false)}
          title="Convert to sales order"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConverting(false)}>
                Cancel
              </Button>
              <Button disabled={!warehouseId} loading={convert.isPending} onClick={() => convert.mutate()}>
                Create order
              </Button>
            </>
          }
        >
          <Field label="Ship from warehouse">
            <EntitySelect<{ id: string; code: string; name: string }>
              endpoint="/inventory/warehouses"
              value={warehouseId}
              onChange={setWarehouseId}
              getLabel={(w) => `${w.code} · ${w.name}`}
            />
          </Field>
        </Modal>
      )}
    </>
  );
}
