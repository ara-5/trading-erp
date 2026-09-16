'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ProductModal, ProductRecord } from '@/components/inventory-modals';
import { ListPage } from '@/components/list-page';
import { Badge, Button, Select } from '@/components/ui';
import { money, num } from '@/lib/format';
import { useOptions } from '@/lib/hooks';

export default function ProductsPage() {
  const [editing, setEditing] = useState<ProductRecord | null | undefined>(undefined);
  const [categoryId, setCategoryId] = useState('');
  const categories = useOptions<{ id: string; name: string }>('/inventory/categories');

  return (
    <>
      <ListPage<ProductRecord>
        title="Products"
        endpoint="/inventory/products"
        searchPlaceholder="Search SKU or name…"
        statuses={[
          { value: 'inactive', label: 'Inactive' },
          { value: 'all', label: 'All products' },
        ]}
        allStatusesLabel="Active"
        query={{ categoryId: categoryId || undefined }}
        filters={
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="sm:w-48" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
        rowHref={(p) => `/inventory/products/${p.id}`}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> New product
          </Button>
        }
        columns={[
          { key: 'sku', header: 'SKU', cell: (p) => <span className="font-mono text-xs">{p.sku}</span> },
          {
            key: 'name',
            header: 'Name',
            cell: (p) => (
              <span className="flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
                {p.name}
                {!p.isActive && <Badge>Inactive</Badge>}
                {!p.trackInventory && <Badge tone="purple">Service</Badge>}
              </span>
            ),
          },
          { key: 'category', header: 'Category', cell: (p) => p.category?.name ?? '—' },
          {
            key: 'onHand',
            header: 'On hand',
            align: 'right',
            cell: (p) =>
              p.trackInventory ? (
                <span className={Number(p.reorderLevel) > 0 && Number(p.onHand) <= Number(p.reorderLevel) ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
                  {num(p.onHand)} {p.uom}
                </span>
              ) : (
                '—'
              ),
          },
          { key: 'cost', header: 'Avg cost', align: 'right', cell: (p) => money(p.costPrice) },
          { key: 'price', header: 'Sale price', align: 'right', cell: (p) => money(p.salePrice) },
        ]}
      />
      {editing !== undefined && <ProductModal product={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
