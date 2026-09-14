'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Button, Card, Field, Input, PageHeader, Select } from '@/components/ui';
import { post } from '@/lib/api';
import { cn, money, today } from '@/lib/format';
import { useAction, useOptions } from '@/lib/hooks';

interface Account {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface Line {
  key: number;
  accountId: string;
  description: string;
  debit: string;
  credit: string;
}

let k = 0;
const blank = (): Line => ({ key: ++k, accountId: '', description: '', debit: '', credit: '' });

export default function NewJournalPage() {
  const router = useRouter();
  const accounts = useOptions<Account>('/accounting/accounts').filter((a) => a.isActive);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const save = useAction(
    async (postNow: boolean) => {
      const entry = await post<{ id: string }>('/accounting/journals', {
        date,
        description,
        reference: reference || null,
        lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({ accountId: l.accountId, description: l.description || null, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
      });
      if (postNow) await post(`/accounting/journals/${entry.id}/post`);
      return entry;
    },
    { success: 'Journal saved', onSuccess: (e) => router.push(`/accounting/journals/${e.id}`) },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(false);
  };

  return (
    <form onSubmit={submit}>
      <PageHeader
        title="Manual journal entry"
        back="/accounting/journals"
        actions={
          <>
            <Button type="submit" variant="secondary" loading={save.isPending}>
              Save draft
            </Button>
            <Button disabled={!balanced || !description} loading={save.isPending} onClick={() => save.mutate(true)}>
              Save & post
            </Button>
          </>
        }
      />
      <Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Date">
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Monthly depreciation" />
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card title="Lines" className="mt-4">
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">Account</th>
                <th className="px-2 py-2 text-left">Memo</th>
                <th className="w-36 px-2 py-2 text-right">Debit</th>
                <th className="w-36 px-2 py-2 text-right">Credit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.key}>
                  <td className="min-w-56 px-2 py-1.5">
                    <Select value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })} className="h-8">
                      <option value="">Select account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="min-w-48 px-2 py-1.5">
                    <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className="h-8" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} className="h-8 text-right tabular" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} className="h-8 text-right tabular" />
                  </td>
                  <td className="px-1">
                    <button type="button" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="rounded p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-30" aria-label="Remove line">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-2 py-2" colSpan={2}>
                  <span className={cn('text-xs', balanced ? 'text-emerald-700' : 'text-rose-600')}>
                    {balanced ? 'Balanced' : `Out of balance by ${money(Math.abs(totalDebit - totalCredit))}`}
                  </span>
                </td>
                <td className="tabular px-4 py-2 text-right">{money(totalDebit)}</td>
                <td className="tabular px-4 py-2 text-right">{money(totalCredit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setLines([...lines, blank()])}>
          <Plus className="size-4" /> Add line
        </Button>
      </Card>
    </form>
  );
}
