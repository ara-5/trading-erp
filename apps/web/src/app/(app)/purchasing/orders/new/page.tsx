'use client';

import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { post } from '@/lib/api';

export default function NewPurchaseOrderPage() {
  return (
    <DocForm
      title="New purchase order"
      back="/purchasing/orders"
      config={{ party: 'supplier', warehouse: true, secondDate: 'Expected date', priceField: 'costPrice' }}
      detailHref={(id) => `/purchasing/orders/${id}`}
      save={(h, lines) =>
        post('/purchasing/orders', {
          supplierId: h.partyId,
          warehouseId: h.warehouseId,
          date: h.date,
          expectedDate: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines),
        })
      }
    />
  );
}
