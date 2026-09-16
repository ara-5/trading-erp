'use client';

import { Plus, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, PageHeader, Textarea } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { useAction, useFields, useGet } from '@/lib/hooks';

interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
}
interface Category {
  id: string;
  name: string;
  _count: { products: number };
}

export default function WarehousesPage() {
  const warehouses = useGet<Warehouse[]>('/inventory/warehouses');
  const categories = useGet<Category[]>('/inventory/categories');
  const [editing, setEditing] = useState<Warehouse | null | undefined>(undefined);
  const [newCategory, setNewCategory] = useState('');

  const addCategory = useAction(() => post('/inventory/categories', { name: newCategory }), { success: 'Category added', onSuccess: () => setNewCategory('') });
  const removeCategory = useAction((id: string) => del(`/inventory/categories/${id}`), { success: 'Category removed' });

  return (
    <>
      <PageHeader
        title="Warehouses & categories"
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" /> New warehouse
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Warehouses" padded={false} className="lg:col-span-2">
          <DataTable
            rows={warehouses.data ?? []}
            loading={warehouses.isLoading}
            onRowClick={setEditing}
            columns={[
              { key: 'code', header: 'Code', cell: (w) => <span className="font-mono text-xs">{w.code}</span> },
              { key: 'name', header: 'Name', cell: (w) => <span className="font-medium text-slate-900 dark:text-slate-100">{w.name}</span> },
              { key: 'address', header: 'Address', cell: (w) => w.address ?? '—' },
              { key: 'status', header: '', cell: (w) => !w.isActive && <Badge>Inactive</Badge> },
            ]}
          />
        </Card>
        <Card title="Product categories">
          <form
            className="mb-3 flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (newCategory.trim()) addCategory.mutate();
            }}
          >
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category" />
            <Button type="submit" variant="secondary" loading={addCategory.isPending}>
              Add
            </Button>
          </form>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {categories.data?.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>
                  {c.name} <span className="text-xs text-slate-500 dark:text-slate-400">({c._count.products})</span>
                </span>
                <button
                  onClick={() => removeCategory.mutate(c.id)}
                  disabled={c._count.products > 0}
                  title={c._count.products > 0 ? 'Category has products' : 'Delete'}
                  className="rounded p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {editing !== undefined && <WarehouseModal warehouse={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function WarehouseModal({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const [f, set] = useFields({ code: warehouse?.code ?? '', name: warehouse?.name ?? '', address: warehouse?.address ?? '', isActive: warehouse?.isActive ?? true });
  const save = useAction(
    () => {
      const body = { ...f, address: f.address || null };
      return warehouse ? patch(`/inventory/warehouses/${warehouse.id}`, body) : post('/inventory/warehouses', body);
    },
    { success: 'Warehouse saved', onSuccess: onClose },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={warehouse ? 'Edit warehouse' : 'New warehouse'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="wh-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="wh-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Code">
          <Input required value={f.code} onChange={(e) => set('code', e.target.value)} autoFocus />
        </Field>
        <Field label="Name">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Address" className="col-span-2">
          <Textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Checkbox label="Active" checked={f.isActive} onChange={(v) => set('isActive', v)} />
      </form>
    </Modal>
  );
}
