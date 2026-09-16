'use client';

import { Pencil, SlidersHorizontal } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AdjustModal, ProductModal, ProductRecord } from '@/components/inventory-modals';
import { Button, Card, DataTable, DescriptionList, Loading, PageHeader, Stat } from '@/components/ui';
import { dateTime, humanize, money, num } from '@/lib/format';
import { useGet } from '@/lib/hooks';

interface ProductDetail extends ProductRecord {
  onHand: string;
  stockValue: string;
  taxRate: { name: string; rate: string } | null;
  stockLevels: { warehouseId: string; quantity: string; warehouse: { code: string; name: string } }[];
  movements: { id: string; date: string; type: string; quantity: string; unitCost: string; reference: string | null; warehouse: { code: string } }[];
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const { data: p } = useGet<ProductDetail>(`/inventory/products/${id}`);
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  if (!p) return <Loading />;
  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={p.sku}
        back="/inventory/products"
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Edit
            </Button>
            {p.trackInventory && (
              <Button onClick={() => setAdjusting(true)}>
                <SlidersHorizontal className="size-4" /> Adjust stock
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="On hand" value={p.trackInventory ? `${num(p.onHand)} ${p.uom}` : 'Not tracked'} hint={Number(p.reorderLevel) > 0 ? `Reorder at ${num(p.reorderLevel)}` : undefined} />
        <Stat label="Average cost" value={money(p.costPrice)} hint={`Sale price ${money(p.salePrice)}`} />
        <Stat label="Stock value" value={money(p.stockValue)} />
      </div>
      <Card className="mt-4">
        <DescriptionList
          items={[
            ['Category', p.category?.name],
            ['Tax', p.taxRate ? `${p.taxRate.name}` : 'No tax'],
            ['Unit', p.uom],
            ['Status', p.isActive ? 'Active' : 'Inactive'],
            ['Description', p.description],
          ]}
        />
      </Card>
      {p.trackInventory && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card title="By warehouse" padded={false}>
            <DataTable
              rows={p.stockLevels.map((l) => ({ ...l, id: l.warehouseId }))}
              empty="No stock"
              columns={[
                { key: 'wh', header: 'Warehouse', cell: (l) => `${l.warehouse.code} · ${l.warehouse.name}` },
                { key: 'qty', header: 'Quantity', align: 'right', cell: (l) => num(l.quantity) },
              ]}
            />
          </Card>
          <Card title="Recent movements" padded={false} className="lg:col-span-2">
            <DataTable
              rows={p.movements}
              empty="No movements yet"
              columns={[
                { key: 'date', header: 'Date', cell: (m) => dateTime(m.date) },
                { key: 'type', header: 'Type', cell: (m) => humanize(m.type) },
                { key: 'wh', header: 'Warehouse', cell: (m) => m.warehouse.code },
                { key: 'ref', header: 'Reference', cell: (m) => m.reference ?? '—' },
                {
                  key: 'qty',
                  header: 'Qty',
                  align: 'right',
                  cell: (m) => <span className={Number(m.quantity) < 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}>{Number(m.quantity) > 0 ? '+' : ''}{num(m.quantity)}</span>,
                },
                { key: 'cost', header: 'Unit cost', align: 'right', cell: (m) => money(m.unitCost) },
              ]}
            />
          </Card>
        </div>
      )}
      {editing && <ProductModal product={p} onClose={() => setEditing(false)} />}
      {adjusting && <AdjustModal productId={p.id} onClose={() => setAdjusting(false)} />}
    </>
  );
}
