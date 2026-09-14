'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Checkbox, ConfirmButton, DataTable, Field, Input, Loading, Modal, PageHeader, Select } from '@/components/ui';
import { del, patch, post } from '@/lib/api';
import { humanize, money } from '@/lib/format';
import { useAction, useFields, useGet } from '@/lib/hooks';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  isActive: boolean;
  balance: string;
}

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

export default function AccountsPage() {
  const [showInactive, setShowInactive] = useState(false);
  const { data } = useGet<Account[]>('/accounting/accounts', { includeInactive: showInactive ? 'true' : undefined });
  const [editing, setEditing] = useState<Account | null | undefined>(undefined);

  const rows = useMemo(() => {
    const accounts = data ?? [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const depth = (a: Account): number => (a.parentId && byId.has(a.parentId) ? depth(byId.get(a.parentId)!) + 1 : 0);
    // Roll child balances up into their header accounts.
    const rolled = (a: Account): number => Number(a.balance) + accounts.filter((c) => c.parentId === a.id).reduce((s, c) => s + rolled(c), 0);
    return accounts.map((a) => ({ ...a, depth: depth(a), total: rolled(a), isHeader: accounts.some((c) => c.parentId === a.id) }));
  }, [data]);

  if (!data) return <Loading />;
  return (
    <>
      <PageHeader
        title="Chart of accounts"
        subtitle="Balances include all posted journal entries"
        actions={
          <>
            <Checkbox label="Show inactive" checked={showInactive} onChange={setShowInactive} />
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" /> New account
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        {TYPES.map((type) => (
          <Card key={type} title={humanize(type)} padded={false}>
            <DataTable
              rows={rows.filter((r) => r.type === type)}
              onRowClick={setEditing}
              columns={[
                { key: 'code', header: 'Code', className: 'w-24', cell: (a) => <span className="font-mono text-xs">{a.code}</span> },
                {
                  key: 'name',
                  header: 'Name',
                  cell: (a) => (
                    <span style={{ paddingLeft: `${a.depth * 1.25}rem` }} className={a.isHeader ? 'font-semibold text-slate-900' : 'text-slate-700'}>
                      {a.name} {!a.isActive && <Badge>Inactive</Badge>}
                    </span>
                  ),
                },
                {
                  key: 'ledger',
                  header: '',
                  cell: (a) => (
                    <Link href={`/accounting/reports?tab=ledger&accountId=${a.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-indigo-600 hover:underline">
                      Ledger
                    </Link>
                  ),
                },
                { key: 'balance', header: 'Balance', align: 'right', cell: (a) => <span className={a.isHeader ? 'font-semibold' : ''}>{money(a.total)}</span> },
              ]}
            />
          </Card>
        ))}
      </div>
      {editing !== undefined && <AccountModal account={editing} accounts={data} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function AccountModal({ account, accounts, onClose }: { account: Account | null; accounts: Account[]; onClose: () => void }) {
  const [f, set] = useFields({
    code: account?.code ?? '',
    name: account?.name ?? '',
    type: account?.type ?? 'EXPENSE',
    parentId: account?.parentId ?? '',
    isActive: account?.isActive ?? true,
  });
  const save = useAction(
    () => {
      const body = { ...f, parentId: f.parentId || null };
      return account ? patch(`/accounting/accounts/${account.id}`, body) : post('/accounting/accounts', body);
    },
    { success: 'Account saved', onSuccess: onClose },
  );
  const remove = useAction(() => del(`/accounting/accounts/${account!.id}`), { success: 'Account deleted', onSuccess: onClose });

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? `Edit ${account.code}` : 'New account'}
      footer={
        <>
          {account && (
            <ConfirmButton variant="danger" className="mr-auto" message="Delete this account?" loading={remove.isPending} onConfirm={() => remove.mutate()}>
              <Trash2 className="size-4" /> Delete
            </ConfirmButton>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="account-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Code">
          <Input required value={f.code} onChange={(e) => set('code', e.target.value)} autoFocus />
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setTypeAndResetParent(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" className="col-span-2">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Parent account" className="col-span-2">
          <Select value={f.parentId} onChange={(e) => set('parentId', e.target.value)}>
            <option value="">None (top level)</option>
            {accounts
              .filter((a) => a.type === f.type && a.id !== account?.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
          </Select>
        </Field>
        <Checkbox label="Active" checked={f.isActive} onChange={(v) => set('isActive', v)} />
      </form>
    </Modal>
  );

  function setTypeAndResetParent(type: string) {
    set('type', type);
    set('parentId', '');
  }
}
