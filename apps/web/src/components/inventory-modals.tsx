'use client';

import { patch, post } from '@/lib/api';
import { useAction, useFields, useOptions } from '@/lib/hooks';
import type { Product } from './line-items';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from './ui';

export interface ProductRecord extends Product {
  description: string | null;
  categoryId: string | null;
  taxRateId: string | null;
  reorderLevel: string;
  onHand?: string;
  category?: { id: string; name: string } | null;
}

interface Named {
  id: string;
  name: string;
}
interface Warehouse {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export function ProductModal({ product, onClose }: { product: ProductRecord | null; onClose: () => void }) {
  const categories = useOptions<Named>('/inventory/categories');
  const taxRates = useOptions<Named & { rate: string }>('/accounting/tax-rates');
  const [f, set] = useFields({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    uom: product?.uom ?? 'pcs',
    categoryId: product?.categoryId ?? '',
    taxRateId: product?.taxRateId ?? '',
    salePrice: String(Number(product?.salePrice ?? 0)),
    costPrice: String(Number(product?.costPrice ?? 0)),
    reorderLevel: String(Number(product?.reorderLevel ?? 0)),
    trackInventory: product?.trackInventory ?? true,
    isActive: product?.isActive ?? true,
  });

  const save = useAction(
    () => {
      const common = {
        sku: f.sku,
        name: f.name,
        description: f.description || null,
        uom: f.uom,
        categoryId: f.categoryId || null,
        taxRateId: f.taxRateId || null,
        salePrice: Number(f.salePrice || 0),
        reorderLevel: Number(f.reorderLevel || 0),
        isActive: f.isActive,
      };
      return product
        ? patch(`/inventory/products/${product.id}`, common)
        : post('/inventory/products', { ...common, trackInventory: f.trackInventory, costPrice: Number(f.costPrice || 0) });
    },
    { success: 'Product saved', onSuccess: onClose },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? `Edit ${product.sku}` : 'New product'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="product-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="SKU">
          <Input required value={f.sku} onChange={(e) => set('sku', e.target.value)} autoFocus />
        </Field>
        <Field label="Unit of measure">
          <Input required value={f.uom} onChange={(e) => set('uom', e.target.value)} />
        </Field>
        <Field label="Name" className="col-span-2">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tax rate">
          <Select value={f.taxRateId} onChange={(e) => set('taxRateId', e.target.value)}>
            <option value="">No tax</option>
            {taxRates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sale price">
          <Input type="number" min="0" step="0.01" value={f.salePrice} onChange={(e) => set('salePrice', e.target.value)} />
        </Field>
        <Field label="Opening cost" hint={product ? 'Maintained automatically (weighted average)' : 'Used until the first receipt'}>
          <Input type="number" min="0" step="0.01" value={f.costPrice} disabled={!!product} onChange={(e) => set('costPrice', e.target.value)} />
        </Field>
        <Field label="Reorder level">
          <Input type="number" min="0" step="any" value={f.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <Checkbox label="Track inventory" checked={f.trackInventory} onChange={(v) => !product && set('trackInventory', v)} />
          <Checkbox label="Active" checked={f.isActive} onChange={(v) => set('isActive', v)} />
        </div>
        <Field label="Description" className="col-span-2">
          <Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function useStockOptions() {
  const products = useOptions<Product>('/inventory/products').filter((p) => p.trackInventory && p.isActive);
  const warehouses = useOptions<Warehouse>('/inventory/warehouses').filter((w) => w.isActive);
  return { products, warehouses };
}

export function AdjustModal({ productId, onClose }: { productId?: string; onClose: () => void }) {
  const { products, warehouses } = useStockOptions();
  const [f, set] = useFields({ productId: productId ?? '', warehouseId: '', direction: 'in', quantity: '', unitCost: '', reason: '' });
  const warehouseId = f.warehouseId || warehouses[0]?.id || '';
  const save = useAction(
    () =>
      post('/inventory/stock/adjust', {
        productId: f.productId,
        warehouseId,
        quantity: (f.direction === 'in' ? 1 : -1) * Number(f.quantity),
        unitCost: f.direction === 'in' && f.unitCost ? Number(f.unitCost) : undefined,
        reason: f.reason,
      }),
    { success: 'Stock adjusted', onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Stock adjustment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-form" loading={save.isPending}>
            Adjust
          </Button>
        </>
      }
    >
      <form
        id="adjust-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Product" className="col-span-2">
          <Select required value={f.productId} onChange={(e) => set('productId', e.target.value)}>
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Warehouse">
          <Select required value={warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Direction">
          <Select value={f.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="in">Increase (found / opening stock)</option>
            <option value="out">Decrease (damaged / lost)</option>
          </Select>
        </Field>
        <Field label="Quantity">
          <Input type="number" min="0" step="any" required value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        {f.direction === 'in' && (
          <Field label="Unit cost" hint="Blank = current average cost">
            <Input type="number" min="0" step="0.01" value={f.unitCost} onChange={(e) => set('unitCost', e.target.value)} />
          </Field>
        )}
        <Field label="Reason" className="col-span-2">
          <Input required value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Stock count, damage, opening balance…" />
        </Field>
      </form>
    </Modal>
  );
}

export function TransferModal({ onClose }: { onClose: () => void }) {
  const { products, warehouses } = useStockOptions();
  const [f, set] = useFields({ productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', reference: '' });
  const save = useAction(
    () => post('/inventory/stock/transfer', { ...f, quantity: Number(f.quantity), reference: f.reference || null }),
    { success: 'Stock transferred', onSuccess: onClose },
  );
  const whOptions = warehouses.map((w) => (
    <option key={w.id} value={w.id}>
      {w.code} · {w.name}
    </option>
  ));
  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer stock"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="transfer-form" loading={save.isPending}>
            Transfer
          </Button>
        </>
      }
    >
      <form
        id="transfer-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Product" className="col-span-2">
          <Select required value={f.productId} onChange={(e) => set('productId', e.target.value)}>
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Select required value={f.fromWarehouseId} onChange={(e) => set('fromWarehouseId', e.target.value)}>
            <option value="">Select…</option>
            {whOptions}
          </Select>
        </Field>
        <Field label="To">
          <Select required value={f.toWarehouseId} onChange={(e) => set('toWarehouseId', e.target.value)}>
            <option value="">Select…</option>
            {whOptions}
          </Select>
        </Field>
        <Field label="Quantity">
          <Input type="number" min="0" step="any" required value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        <Field label="Reference">
          <Input value={f.reference} onChange={(e) => set('reference', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
