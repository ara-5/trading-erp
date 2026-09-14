'use client';

import { FormEvent, useState } from 'react';
import { patch, post } from '@/lib/api';
import { num, today } from '@/lib/format';
import { useAction, useFields, useOptions } from '@/lib/hooks';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from './ui';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

/** Cash/bank style accounts: active assets, excluding receivables, inventory and tax. */
export function useCashAccounts() {
  const accounts = useOptions<Account>('/accounting/accounts');
  return accounts.filter((a) => a.type === 'ASSET' && a.isActive && !/receivable|inventory|tax|fixed|^assets$/i.test(a.name));
}

export function PaymentModal({
  direction,
  partyId,
  doc,
  onClose,
}: {
  direction: 'RECEIVED' | 'PAID';
  partyId: string;
  doc?: { id: string; number: string; outstanding: number; kind: 'invoice' | 'bill' };
  onClose: () => void;
}) {
  const cash = useCashAccounts();
  const [f, set] = useFields({
    date: today(),
    amount: doc ? String(doc.outstanding.toFixed(2)) : '',
    accountId: '',
    method: 'BANK_TRANSFER',
    reference: '',
    notes: '',
  });
  const accountId = f.accountId || cash.find((a) => /bank/i.test(a.name))?.id || cash[0]?.id || '';

  const pay = useAction(
    () =>
      post('/accounting/payments', {
        direction,
        date: f.date,
        amount: Number(f.amount),
        accountId,
        method: f.method,
        reference: f.reference || null,
        notes: f.notes || null,
        customerId: direction === 'RECEIVED' ? partyId : null,
        supplierId: direction === 'PAID' ? partyId : null,
        salesInvoiceId: doc?.kind === 'invoice' ? doc.id : null,
        purchaseBillId: doc?.kind === 'bill' ? doc.id : null,
      }),
    { success: 'Payment recorded', onSuccess: onClose },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    pay.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={direction === 'RECEIVED' ? `Receive payment${doc ? ` for ${doc.number}` : ''}` : `Pay${doc ? ` ${doc.number}` : ' supplier'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" loading={pay.isPending}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label="Date">
          <Input type="date" required value={f.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Amount" hint={doc ? `Outstanding ${num(doc.outstanding, 2)}` : undefined}>
          <Input type="number" min="0.01" step="0.01" required value={f.amount} onChange={(e) => set('amount', e.target.value)} className="text-right tabular" />
        </Field>
        <Field label={direction === 'RECEIVED' ? 'Deposit to' : 'Pay from'}>
          <Select required value={accountId} onChange={(e) => set('accountId', e.target.value)}>
            {cash.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Method">
          <Select value={f.method} onChange={(e) => set('method', e.target.value)}>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Reference" className="col-span-2">
          <Input value={f.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Transaction or cheque number" />
        </Field>
      </form>
    </Modal>
  );
}

export interface FulfilLine {
  id: string;
  label: string;
  remaining: number;
  uom?: string;
}

/** Enter quantities per line for deliveries and goods receipts. */
export function FulfilModal({ title, action, lines, onSubmit, onClose, pending }: { title: string; action: string; lines: FulfilLine[]; onSubmit: (body: { date: string; lines: { lineId: string; quantity: number }[] }) => void; onClose: () => void; pending?: boolean }) {
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.remaining)])));
  const open = lines.filter((l) => l.remaining > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={() =>
              onSubmit({
                date,
                lines: open.map((l) => ({ lineId: l.id, quantity: Number(qty[l.id] || 0) })).filter((l) => l.quantity > 0),
              })
            }
          >
            {action}
          </Button>
        </>
      }
    >
      <Field label="Date" className="mb-4 w-48">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <table className="min-w-full text-sm">
        <thead className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 text-left">Item</th>
            <th className="py-2 text-right">Remaining</th>
            <th className="w-32 py-2 text-right">Quantity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {open.map((l) => (
            <tr key={l.id}>
              <td className="py-2 pr-2 text-slate-800">{l.label}</td>
              <td className="tabular py-2 text-right text-slate-600">
                {num(l.remaining)} {l.uom}
              </td>
              <td className="py-2 pl-2">
                <Input type="number" min="0" max={l.remaining} step="any" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} className="h-8 text-right tabular" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export interface PartyRecord {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  paymentTermsDays: number;
  creditLimit?: string;
  isActive: boolean;
}

/** Create/edit form for customers and suppliers. */
export function PartyModal({ kind, party, onClose }: { kind: 'customer' | 'supplier'; party: PartyRecord | null; onClose: () => void }) {
  const [f, set] = useFields({
    code: party?.code ?? '',
    name: party?.name ?? '',
    email: party?.email ?? '',
    phone: party?.phone ?? '',
    address: party?.address ?? '',
    taxNumber: party?.taxNumber ?? '',
    paymentTermsDays: String(party?.paymentTermsDays ?? 30),
    creditLimit: String(Number(party?.creditLimit ?? 0)),
    isActive: party?.isActive ?? true,
  });
  const base = kind === 'customer' ? '/sales/customers' : '/purchasing/suppliers';
  const save = useAction(
    () => {
      const body = {
        ...(party ? {} : { code: f.code || undefined }),
        name: f.name,
        email: f.email || null,
        phone: f.phone || null,
        address: f.address || null,
        taxNumber: f.taxNumber || null,
        paymentTermsDays: Number(f.paymentTermsDays),
        isActive: f.isActive,
        ...(kind === 'customer' ? { creditLimit: Number(f.creditLimit || 0) } : {}),
      };
      return party ? patch(`${base}/${party.id}`, body) : post(base, body);
    },
    { success: `${kind === 'customer' ? 'Customer' : 'Supplier'} saved`, onSuccess: onClose },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`${party ? 'Edit' : 'New'} ${kind}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="party-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="party-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid grid-cols-2 gap-4"
      >
        <Field label="Name" className="col-span-2">
          <Input required value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Code" hint={party ? undefined : 'Leave blank to auto-generate'}>
          <Input value={f.code} disabled={!!party} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Tax number">
          <Input value={f.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Address" className="col-span-2">
          <Textarea rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Payment terms (days)">
          <Input type="number" min="0" max="365" value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} />
        </Field>
        {kind === 'customer' && (
          <Field label="Credit limit" hint="0 = no limit">
            <Input type="number" min="0" step="0.01" value={f.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} />
          </Field>
        )}
        <div className="col-span-2">
          <Checkbox label="Active" checked={f.isActive} onChange={(v) => set('isActive', v)} />
        </div>
      </form>
    </Modal>
  );
}
