'use client';

import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { post } from '@/lib/api';

export default function NewSalesOrderPage() {
  return (
    <DocForm
      title="New sales order"
      back="/sales/orders"
      config={{ party: 'customer', warehouse: true, showDiscount: true }}
      detailHref={(id) => `/sales/orders/${id}`}
      save={(h, lines) =>
        post('/sales/orders', {
          customerId: h.partyId,
          warehouseId: h.warehouseId,
          date: h.date,
          notes: orNull(h.notes),
          lines: linesPayload(lines, { discount: true }),
        })
      }
    />
  );
}
