'use client';

import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { post } from '@/lib/api';

export default function NewQuotationPage() {
  return (
    <DocForm
      title="New quotation"
      back="/sales/quotations"
      config={{ party: 'customer', secondDate: 'Valid until', showDiscount: true }}
      detailHref={(id) => `/sales/quotations/${id}`}
      save={(h, lines) =>
        post('/sales/quotations', {
          customerId: h.partyId,
          date: h.date,
          validUntil: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines, { discount: true }),
        })
      }
    />
  );
}
