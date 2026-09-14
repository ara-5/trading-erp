'use client';

import { useParams } from 'next/navigation';
import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { Loading } from '@/components/ui';
import { put } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import type { QuotationDetail } from '@/lib/types';

export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>();
  const { data: q } = useGet<QuotationDetail>(`/sales/quotations/${id}`);
  if (!q) return <Loading />;
  return (
    <DocForm
      title={`Edit ${q.number}`}
      back={`/sales/quotations/${id}`}
      config={{ party: 'customer', secondDate: 'Valid until', showDiscount: true }}
      initial={{ partyId: q.customerId, date: q.date, secondDate: q.validUntil, notes: q.notes, lines: q.lines }}
      detailHref={(docId) => `/sales/quotations/${docId}`}
      save={(h, lines) =>
        put(`/sales/quotations/${id}`, {
          customerId: h.partyId,
          date: h.date,
          validUntil: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines, { discount: true }),
        }).then(() => ({ id }))
      }
    />
  );
}
