'use client';

import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { post } from '@/lib/api';

export default function NewInvoicePage() {
  return (
    <DocForm
      title="New invoice"
      back="/sales/invoices"
      config={{ party: 'customer', secondDate: 'Due date', showDiscount: true, productFilter: (p) => !p.trackInventory }}
      detailHref={(id) => `/sales/invoices/${id}`}
      save={(h, lines) =>
        post('/sales/invoices', {
          customerId: h.partyId,
          date: h.date,
          dueDate: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines, { discount: true }),
        })
      }
    />
  );
}
