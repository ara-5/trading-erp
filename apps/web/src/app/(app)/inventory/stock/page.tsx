'use client';

import { AlertTriangle, ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AdjustModal, TransferModal } from '@/components/inventory-modals';
import { ListPage } from '@/components/list-page';
import { Button, Card, Select, Stat } from '@/components/ui';
import { money, num } from '@/lib/format';
import { useGet, useOptions } from '@/lib/hooks';

interface Level {
  productId: string;
  warehouseId: string;
  quantity: string;
  value: string;
  product: { id: string; sku: string; name: string; uom: string; costPrice: string };
  warehouse: { code: string; name: string };
}

export default function StockPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const [modal, setModal] = useState<'adjust' | 'transfer' | null>(null);
  const warehouses = useOptions<{ id: string; code: string; name: string }>('/inventory/warehouses');
  const valuation = useGet<{ total: string }>('/inventory/stock/valuation');
  const low = useGet<{ id: string; sku: string; name: string; uom: string; reorderLevel: string; onHand: string }[]>('/inventory/stock/low');

  return (
    <>
      <ListPage<Level & { id: string }>
        title="Stock levels"
        endpoint="/inventory/stock"
        searchPlaceholder="Search SKU or name…"
        query={{ warehouseId: warehouseId || undefined }}
        filters={
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="sm:w-56" aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal('transfer')}>
              <ArrowLeftRight className="size-4" /> Transfer
            </Button>
            <Button onClick={() => setModal('adjust')}>
              <SlidersHorizontal className="size-4" /> Adjust
            </Button>
          </>
        }
        rowHref={(l) => `/inventory/products/${l.productId}`}
        columns={[
          { key: 'sku', header: 'SKU', cell: (l) => <span className="font-mono text-xs">{l.product.sku}</span> },
          { key: 'name', header: 'Product', cell: (l) => <span className="font-medium text-slate-900 dark:text-slate-100">{l.product.name}</span> },
          { key: 'wh', header: 'Warehouse', cell: (l) => l.warehouse.code },
          { key: 'qty', header: 'Quantity', align: 'right', cell: (l) => `${num(l.quantity)} ${l.product.uom}` },
          { key: 'cost', header: 'Avg cost', align: 'right', cell: (l) => money(l.product.costPrice) },
          { key: 'value', header: 'Value', align: 'right', cell: (l) => money(l.value) },
        ]}
      >
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Stat label="Total inventory value" value={money(valuation.data?.total)} hint="Quantity × moving average cost" />
          <Card
            className="lg:col-span-2"
            title={
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-amber-600" /> At or below reorder level
              </span>
            }
            padded={false}
          >
            {low.data?.length ? (
              <ul className="max-h-40 divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto text-sm">
                {low.data.map((p) => (
                  <li key={p.id} className="flex justify-between px-4 py-2">
                    <Link href={`/inventory/products/${p.id}`} className="text-slate-800 dark:text-slate-200 hover:text-indigo-600">
                      {p.sku} · {p.name}
                    </Link>
                    <span className="tabular text-amber-700 dark:text-amber-400">
                      {num(p.onHand)} / {num(p.reorderLevel)} {p.uom}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Everything is above its reorder level</p>
            )}
          </Card>
        </div>
      </ListPage>
      {modal === 'adjust' && <AdjustModal onClose={() => setModal(null)} />}
      {modal === 'transfer' && <TransferModal onClose={() => setModal(null)} />}
    </>
  );
}
