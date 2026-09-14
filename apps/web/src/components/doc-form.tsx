'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { inputDate, today } from '@/lib/format';
import { useAction, useOptions } from '@/lib/hooks';
import { LineDraft, LineItems, newLine, Product, toDrafts } from './line-items';
import { EntitySelect } from './list-page';
import { Button, Card, Field, Input, PageHeader, Textarea } from './ui';

export interface DocHeader {
  partyId: string;
  date: string;
  warehouseId: string;
  secondDate: string;
  reference: string;
  notes: string;
}

export interface DocInitial {
  partyId?: string;
  warehouseId?: string;
  date?: string;
  secondDate?: string | null;
  reference?: string | null;
  notes?: string | null;
  lines?: Parameters<typeof toDrafts>[0];
}

export interface DocFormConfig {
  party: 'customer' | 'supplier';
  warehouse?: boolean;
  secondDate?: string; // label, e.g. "Valid until" or "Due date"
  reference?: string; // label, e.g. "Supplier reference"
  priceField?: 'salePrice' | 'costPrice';
  showDiscount?: boolean;
  allowAccount?: boolean;
  productFilter?: (p: Product) => boolean;
  lockParty?: boolean;
}

interface Party {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface Warehouse {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Shared create/edit form for quotations, orders, invoices, purchase orders and bills. */
export function DocForm({
  title,
  back,
  config,
  initial,
  save,
  detailHref,
}: {
  title: string;
  back: string;
  config: DocFormConfig;
  initial?: DocInitial;
  save: (header: DocHeader, lines: LineDraft[]) => Promise<{ id: string }>;
  detailHref: (id: string) => string;
}) {
  const router = useRouter();
  const [header, setHeader] = useState<DocHeader>({
    partyId: initial?.partyId ?? new URLSearchParams(window.location.search).get('partyId') ?? '',
    date: inputDate(initial?.date) || today(),
    warehouseId: initial?.warehouseId ?? '',
    secondDate: inputDate(initial?.secondDate),
    reference: initial?.reference ?? '',
    notes: initial?.notes ?? '',
  });
  const [lines, setLines] = useState<LineDraft[]>(() => (initial?.lines?.length ? toDrafts(initial.lines) : [newLine()]));
  const set = (k: keyof DocHeader, v: string) => setHeader((h) => ({ ...h, [k]: v }));

  const warehouses = useOptions<Warehouse>('/inventory/warehouses');
  useEffect(() => {
    if (config.warehouse && !header.warehouseId && warehouses[0]) set('warehouseId', warehouses[0].id);
  }, [config.warehouse, header.warehouseId, warehouses]);

  const submit = useAction(() => save(header, lines), { success: 'Saved', onSuccess: (doc) => router.push(detailHref(doc.id)) });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit.mutate();
  }

  const partyEndpoint = config.party === 'customer' ? '/sales/customers' : '/purchasing/suppliers';

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        title={title}
        back={back}
        actions={
          <>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={submit.isPending}>
              Save draft
            </Button>
          </>
        }
      />
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={config.party === 'customer' ? 'Customer' : 'Supplier'} className="sm:col-span-2">
            <EntitySelect<Party>
              endpoint={partyEndpoint}
              value={header.partyId}
              onChange={(id) => set('partyId', id)}
              getLabel={(p) => `${p.name} (${p.code})`}
              filter={(p) => p.isActive}
              required
              disabled={config.lockParty}
            />
          </Field>
          <Field label="Date">
            <Input type="date" required value={header.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          {config.secondDate && (
            <Field label={config.secondDate} hint={config.secondDate === 'Due date' ? 'Defaults to the payment terms' : undefined}>
              <Input type="date" value={header.secondDate} onChange={(e) => set('secondDate', e.target.value)} />
            </Field>
          )}
          {config.warehouse && (
            <Field label="Warehouse">
              <EntitySelect<Warehouse>
                endpoint="/inventory/warehouses"
                value={header.warehouseId}
                onChange={(id) => set('warehouseId', id)}
                getLabel={(w) => `${w.code} · ${w.name}`}
                filter={(w) => w.isActive}
                required
              />
            </Field>
          )}
          {config.reference && (
            <Field label={config.reference}>
              <Input value={header.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Line items" className="mt-4">
        <LineItems
          lines={lines}
          onChange={setLines}
          priceField={config.priceField}
          showDiscount={config.showDiscount}
          allowAccount={config.allowAccount}
          productFilter={config.productFilter}
        />
      </Card>

      <Card title="Notes" className="mt-4">
        <Textarea value={header.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Internal notes or terms shown on the document" />
      </Card>
    </form>
  );
}

export const orNull = (s: string) => (s ? s : null);
