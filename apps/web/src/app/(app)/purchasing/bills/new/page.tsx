'use client';

import { DocForm, orNull } from '@/components/doc-form';
import { LineDraft, linesPayload } from '@/components/line-items';
import { post } from '@/lib/api';

const billLines = (lines: LineDraft[]) => linesPayload(lines, { account: true }).map((l) => ({ ...l, description: l.description ?? '' }));

export default function NewBillPage() {
  return (
    <DocForm
      title="New bill"
      back="/purchasing/bills"
      config={{
        party: 'supplier',
        secondDate: 'Due date',
        reference: 'Supplier invoice #',
        priceField: 'costPrice',
        allowAccount: true,
        productFilter: (p) => !p.trackInventory,
      }}
      detailHref={(id) => `/purchasing/bills/${id}`}
      save={(h, lines) =>
        post('/purchasing/bills', {
          supplierId: h.partyId,
          supplierRef: orNull(h.reference),
          date: h.date,
          dueDate: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: billLines(lines),
        })
      }
    />
  );
}
