'use client';

import { useParams } from 'next/navigation';
import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { Loading } from '@/components/ui';
import { put } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import type { BillDetail } from '@/lib/types';

export default function EditBillPage() {
  const { id } = useParams<{ id: string }>();
  const { data: bill } = useGet<BillDetail>(`/purchasing/bills/${id}`);
  if (!bill) return <Loading />;
  const fromOrder = !!bill.purchaseOrderId;
  return (
    <DocForm
      title={`Edit ${bill.number}`}
      back={`/purchasing/bills/${id}`}
      config={{
        party: 'supplier',
        secondDate: 'Due date',
        reference: 'Supplier invoice #',
        priceField: 'costPrice',
        allowAccount: true,
        lockParty: fromOrder,
        productFilter: fromOrder ? undefined : (p) => !p.trackInventory,
      }}
      initial={{ partyId: bill.supplierId, date: bill.date, secondDate: bill.dueDate, reference: bill.supplierRef, notes: bill.notes, lines: bill.lines }}
      detailHref={(docId) => `/purchasing/bills/${docId}`}
      save={(h, lines) =>
        put(`/purchasing/bills/${id}`, {
          supplierId: h.partyId,
          supplierRef: orNull(h.reference),
          date: h.date,
          dueDate: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines, { account: true }).map((l) => ({ ...l, description: l.description ?? '' })),
        }).then(() => ({ id }))
      }
    />
  );
}
