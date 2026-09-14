'use client';

import { Pencil, Wallet } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PartyModal, PartyRecord, PaymentModal } from '@/components/modals';
import { Button, Card, DataTable, DescriptionList, LinkButton, Loading, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { date, money } from '@/lib/format';
import { useGet } from '@/lib/hooks';

interface Doc {
  id: string;
  number: string;
  date: string;
  status: string;
  total: string;
  amountPaid?: string;
}
interface CustomerDetail extends PartyRecord {
  outstanding: string;
  quotations: Doc[];
  salesOrders: Doc[];
  invoices: Doc[];
  payments: { id: string; number: string; date: string; amount: string; method: string }[];
}

const docColumns = (href: string) => [
  { key: 'number', header: 'Number', cell: (d: Doc) => <span className="font-medium text-slate-900">{d.number}</span> },
  { key: 'date', header: 'Date', cell: (d: Doc) => date(d.date) },
  { key: 'status', header: 'Status', cell: (d: Doc) => <StatusBadge status={d.status} /> },
  { key: 'total', header: 'Total', align: 'right' as const, cell: (d: Doc) => money(d.total) },
];

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c } = useGet<CustomerDetail>(`/sales/customers/${id}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (!c) return <Loading />;
  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={c.code}
        back="/sales/customers"
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button variant="secondary" onClick={() => setPaying(true)}>
              <Wallet className="size-4" /> Receive payment
            </Button>
            <LinkButton href={`/sales/orders/new?partyId=${c.id}`}>New order</LinkButton>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <DescriptionList
            items={[
              ['Email', c.email],
              ['Phone', c.phone],
              ['Tax number', c.taxNumber],
              ['Payment terms', `${c.paymentTermsDays} days`],
              ['Credit limit', Number(c.creditLimit) > 0 ? money(c.creditLimit) : 'No limit'],
              ['Address', c.address],
              ['Status', c.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        </Card>
        <Stat label="Outstanding balance" value={money(c.outstanding)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Invoices" padded={false}>
          <DataTable rows={c.invoices} rowHref={(d) => `/sales/invoices/${d.id}`} columns={docColumns('invoices')} empty="No invoices" />
        </Card>
        <Card title="Sales orders" padded={false}>
          <DataTable rows={c.salesOrders} rowHref={(d) => `/sales/orders/${d.id}`} columns={docColumns('orders')} empty="No orders" />
        </Card>
        <Card title="Quotations" padded={false}>
          <DataTable rows={c.quotations} rowHref={(d) => `/sales/quotations/${d.id}`} columns={docColumns('quotations')} empty="No quotations" />
        </Card>
        <Card title="Payments" padded={false}>
          <DataTable
            rows={c.payments}
            empty="No payments"
            columns={[
              { key: 'number', header: 'Receipt', cell: (p) => <span className="font-medium text-slate-900">{p.number}</span> },
              { key: 'date', header: 'Date', cell: (p) => date(p.date) },
              { key: 'amount', header: 'Amount', align: 'right', cell: (p) => money(p.amount) },
            ]}
          />
        </Card>
      </div>

      {editing && <PartyModal kind="customer" party={c} onClose={() => setEditing(false)} />}
      {paying && <PaymentModal direction="RECEIVED" partyId={c.id} onClose={() => setPaying(false)} />}
    </>
  );
}
