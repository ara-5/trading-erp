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
}
interface SupplierDetail extends PartyRecord {
  outstanding: string;
  purchaseOrders: Doc[];
  bills: Doc[];
}

const columns = [
  { key: 'number', header: 'Number', cell: (d: Doc) => <span className="font-medium text-slate-900 dark:text-slate-100">{d.number}</span> },
  { key: 'date', header: 'Date', cell: (d: Doc) => date(d.date) },
  { key: 'status', header: 'Status', cell: (d: Doc) => <StatusBadge status={d.status} /> },
  { key: 'total', header: 'Total', align: 'right' as const, cell: (d: Doc) => money(d.total) },
];

export default function SupplierPage() {
  const { id } = useParams<{ id: string }>();
  const { data: s } = useGet<SupplierDetail>(`/purchasing/suppliers/${id}`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (!s) return <Loading />;
  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={s.code}
        back="/purchasing/suppliers"
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button variant="secondary" onClick={() => setPaying(true)}>
              <Wallet className="size-4" /> Make payment
            </Button>
            <LinkButton href={`/purchasing/orders/new?partyId=${s.id}`}>New purchase order</LinkButton>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3">
          <DescriptionList
            items={[
              ['Email', s.email],
              ['Phone', s.phone],
              ['Tax number', s.taxNumber],
              ['Payment terms', `${s.paymentTermsDays} days`],
              ['Address', s.address],
              ['Status', s.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        </Card>
        <Stat label="We owe" value={money(s.outstanding)} />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Purchase orders" padded={false}>
          <DataTable rows={s.purchaseOrders} rowHref={(d) => `/purchasing/orders/${d.id}`} columns={columns} empty="No purchase orders" />
        </Card>
        <Card title="Bills" padded={false}>
          <DataTable rows={s.bills} rowHref={(d) => `/purchasing/bills/${d.id}`} columns={columns} empty="No bills" />
        </Card>
      </div>
      {editing && <PartyModal kind="supplier" party={s} onClose={() => setEditing(false)} />}
      {paying && <PaymentModal direction="PAID" partyId={s.id} onClose={() => setPaying(false)} />}
    </>
  );
}
