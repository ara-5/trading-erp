'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { EntitySelect, ListPage } from '@/components/list-page';
import { PaymentModal } from '@/components/modals';
import { Badge, Button, Field, Modal, Select } from '@/components/ui';
import { date, humanize, money } from '@/lib/format';
import { useOptions } from '@/lib/hooks';

interface Payment {
  id: string;
  number: string;
  date: string;
  direction: 'RECEIVED' | 'PAID';
  method: string;
  amount: string;
  reference: string | null;
  customer: { name: string } | null;
  supplier: { name: string } | null;
  account: { code: string; name: string };
  salesInvoice: { number: string } | null;
  purchaseBill: { number: string } | null;
}

export default function PaymentsPage() {
  const [direction, setDirection] = useState('');
  const [starting, setStarting] = useState<'RECEIVED' | 'PAID' | null>(null);

  return (
    <>
      <ListPage<Payment>
        title="Payments"
        endpoint="/accounting/payments"
        searchPlaceholder="Search number or reference…"
        query={{ direction: direction || undefined }}
        filters={
          <Select value={direction} onChange={(e) => setDirection(e.target.value)} className="sm:w-44" aria-label="Direction">
            <option value="">All payments</option>
            <option value="RECEIVED">Received</option>
            <option value="PAID">Paid</option>
          </Select>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setStarting('PAID')}>
              <ArrowUpRight className="size-4" /> Pay supplier
            </Button>
            <Button onClick={() => setStarting('RECEIVED')}>
              <ArrowDownLeft className="size-4" /> Receive payment
            </Button>
          </>
        }
        columns={[
          { key: 'number', header: 'Number', cell: (p) => <span className="font-medium text-slate-900">{p.number}</span> },
          { key: 'date', header: 'Date', cell: (p) => date(p.date) },
          { key: 'dir', header: 'Type', cell: (p) => (p.direction === 'RECEIVED' ? <Badge tone="green">Received</Badge> : <Badge tone="blue">Paid</Badge>) },
          { key: 'party', header: 'Party', cell: (p) => p.customer?.name ?? p.supplier?.name },
          { key: 'doc', header: 'Applied to', cell: (p) => p.salesInvoice?.number ?? p.purchaseBill?.number ?? 'On account' },
          { key: 'account', header: 'Account', cell: (p) => `${p.account.code} · ${p.account.name}` },
          { key: 'method', header: 'Method', cell: (p) => humanize(p.method) },
          { key: 'amount', header: 'Amount', align: 'right', cell: (p) => money(p.amount) },
        ]}
      />
      {starting && <StartPayment direction={starting} onClose={() => setStarting(null)} />}
    </>
  );
}

interface OpenDoc {
  id: string;
  number: string;
  total: string;
  amountPaid: string;
  customerId?: string;
  supplierId?: string;
}

/** Pick the party and (optionally) the open document, then hand off to the payment form. */
function StartPayment({ direction, onClose }: { direction: 'RECEIVED' | 'PAID'; onClose: () => void }) {
  const incoming = direction === 'RECEIVED';
  const [partyId, setPartyId] = useState('');
  const [docId, setDocId] = useState('');
  const [ready, setReady] = useState(false);
  const base = incoming ? '/sales/invoices' : '/purchasing/bills';
  const posted = useOptions<OpenDoc>(base, { status: 'POSTED' });
  const partial = useOptions<OpenDoc>(base, { status: 'PARTIALLY_PAID' });
  const docs = [...posted, ...partial].filter((d) => (incoming ? d.customerId : d.supplierId) === partyId);
  const doc = docs.find((d) => d.id === docId);

  if (ready) {
    return (
      <PaymentModal
        direction={direction}
        partyId={partyId}
        doc={doc ? { id: doc.id, number: doc.number, outstanding: Number(doc.total) - Number(doc.amountPaid), kind: incoming ? 'invoice' : 'bill' } : undefined}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={incoming ? 'Receive payment' : 'Pay supplier'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!partyId} onClick={() => setReady(true)}>
            Continue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={incoming ? 'Customer' : 'Supplier'}>
          <EntitySelect<{ id: string; code: string; name: string }>
            endpoint={incoming ? '/sales/customers' : '/purchasing/suppliers'}
            value={partyId}
            onChange={(id) => {
              setPartyId(id);
              setDocId('');
            }}
            getLabel={(p) => `${p.name} (${p.code})`}
          />
        </Field>
        <Field label={incoming ? 'Apply to invoice' : 'Apply to bill'} hint="Leave empty to record an on-account payment">
          <Select value={docId} onChange={(e) => setDocId(e.target.value)} disabled={!partyId}>
            <option value="">On account</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.number} — outstanding {money(Number(d.total) - Number(d.amountPaid))}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
