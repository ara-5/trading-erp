'use client';

import { useState } from 'react';
import { ListPage } from '@/components/list-page';
import { Select } from '@/components/ui';
import { dateTime, humanize, money, num } from '@/lib/format';
import { useOptions } from '@/lib/hooks';

interface Movement {
  id: string;
  date: string;
  type: string;
  quantity: string;
  unitCost: string;
  reference: string | null;
  product: { id: string; sku: string; name: string; uom: string };
  warehouse: { code: string };
}

export default function MovementsPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const warehouses = useOptions<{ id: string; code: string; name: string }>('/inventory/warehouses');
  return (
    <ListPage<Movement>
      title="Stock movements"
      subtitle="Every receipt, delivery, transfer and adjustment"
      endpoint="/inventory/movements"
      searchPlaceholder="Search SKU or reference…"
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
      rowHref={(m) => `/inventory/products/${m.product.id}`}
      columns={[
        { key: 'date', header: 'Date', cell: (m) => dateTime(m.date) },
        { key: 'type', header: 'Type', cell: (m) => humanize(m.type) },
        { key: 'product', header: 'Product', cell: (m) => `${m.product.sku} · ${m.product.name}` },
        { key: 'wh', header: 'Warehouse', cell: (m) => m.warehouse.code },
        { key: 'ref', header: 'Reference', cell: (m) => m.reference ?? '—' },
        {
          key: 'qty',
          header: 'Quantity',
          align: 'right',
          cell: (m) => (
            <span className={Number(m.quantity) < 0 ? 'text-rose-600' : 'text-emerald-700'}>
              {Number(m.quantity) > 0 ? '+' : ''}
              {num(m.quantity)} {m.product.uom}
            </span>
          ),
        },
        { key: 'cost', header: 'Unit cost', align: 'right', cell: (m) => money(m.unitCost) },
      ]}
    />
  );
}
