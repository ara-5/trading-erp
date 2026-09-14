'use client';

import { useParams } from 'next/navigation';
import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { Loading } from '@/components/ui';
import { put } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import type { SalesOrderDetail } from '@/lib/types';

export default function EditSalesOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: so } = useGet<SalesOrderDetail>(`/sales/orders/${id}`);
  if (!so) return <Loading />;
  return (
    <DocForm
      title={`Edit ${so.number}`}
      back={`/sales/orders/${id}`}
      config={{ party: 'customer', warehouse: true, showDiscount: true }}
      initial={{ partyId: so.customerId, warehouseId: so.warehouseId, date: so.date, notes: so.notes, lines: so.lines }}
      detailHref={(docId) => `/sales/orders/${docId}`}
      save={(h, lines) =>
        put(`/sales/orders/${id}`, {
          customerId: h.partyId,
          warehouseId: h.warehouseId,
          date: h.date,
          notes: orNull(h.notes),
          lines: linesPayload(lines, { discount: true }),
        }).then(() => ({ id }))
      }
    />
  );
}
