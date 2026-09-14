'use client';

import { useParams } from 'next/navigation';
import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { Loading } from '@/components/ui';
import { put } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import type { PurchaseOrderDetail } from '@/lib/types';

export default function EditPurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: po } = useGet<PurchaseOrderDetail>(`/purchasing/orders/${id}`);
  if (!po) return <Loading />;
  return (
    <DocForm
      title={`Edit ${po.number}`}
      back={`/purchasing/orders/${id}`}
      config={{ party: 'supplier', warehouse: true, secondDate: 'Expected date', priceField: 'costPrice' }}
      initial={{ partyId: po.supplierId, warehouseId: po.warehouseId, date: po.date, secondDate: po.expectedDate, notes: po.notes, lines: po.lines }}
      detailHref={(docId) => `/purchasing/orders/${docId}`}
      save={(h, lines) =>
        put(`/purchasing/orders/${id}`, {
          supplierId: h.partyId,
          warehouseId: h.warehouseId,
          date: h.date,
          expectedDate: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines),
        }).then(() => ({ id }))
      }
    />
  );
}
