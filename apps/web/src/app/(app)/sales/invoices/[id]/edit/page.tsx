'use client';

import { useParams } from 'next/navigation';
import { DocForm, orNull } from '@/components/doc-form';
import { linesPayload } from '@/components/line-items';
import { Loading } from '@/components/ui';
import { put } from '@/lib/api';
import { useGet } from '@/lib/hooks';
import type { InvoiceDetail } from '@/lib/types';

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { data: inv } = useGet<InvoiceDetail>(`/sales/invoices/${id}`);
  if (!inv) return <Loading />;
  const fromOrder = !!inv.salesOrderId;
  return (
    <DocForm
      title={`Edit ${inv.number}`}
      back={`/sales/invoices/${id}`}
      config={{ party: 'customer', secondDate: 'Due date', showDiscount: true, lockParty: fromOrder, productFilter: fromOrder ? undefined : (p) => !p.trackInventory }}
      initial={{ partyId: inv.customerId, date: inv.date, secondDate: inv.dueDate, notes: inv.notes, lines: inv.lines }}
      detailHref={(docId) => `/sales/invoices/${docId}`}
      save={(h, lines) =>
        put(`/sales/invoices/${id}`, {
          customerId: h.partyId,
          date: h.date,
          dueDate: orNull(h.secondDate),
          notes: orNull(h.notes),
          lines: linesPayload(lines, { discount: true }),
        }).then(() => ({ id }))
      }
    />
  );
}
