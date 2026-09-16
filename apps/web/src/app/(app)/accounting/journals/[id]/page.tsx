'use client';

import { Ban, BookCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, ConfirmButton, DataTable, DescriptionList, Loading, PageHeader, StatusBadge } from '@/components/ui';
import { del, post } from '@/lib/api';
import { date, dateTime, humanize, money } from '@/lib/format';
import { useAction, useGet } from '@/lib/hooks';

interface Entry {
  id: string;
  number: string;
  date: string;
  description: string;
  reference: string | null;
  status: string;
  sourceType: string;
  sourceId: string | null;
  postedAt: string | null;
  lines: { id: string; debit: string; credit: string; description: string | null; account: { id: string; code: string; name: string } }[];
}

const sourceHref: Record<string, string> = {
  SALES_INVOICE: '/sales/invoices/',
  PURCHASE_BILL: '/purchasing/bills/',
  PAYROLL: '/hr/payroll/',
};

export default function JournalPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: e } = useGet<Entry>(`/accounting/journals/${id}`);
  const postEntry = useAction(() => post(`/accounting/journals/${id}/post`), { success: 'Entry posted' });
  const voidEntry = useAction(() => post(`/accounting/journals/${id}/void`), { success: 'Entry voided' });
  const remove = useAction(() => del(`/accounting/journals/${id}`), { success: 'Draft deleted', onSuccess: () => router.push('/accounting/journals') });

  if (!e) return <Loading />;
  const manual = e.sourceType === 'MANUAL';
  const totalDebit = e.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = e.lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {e.number} <StatusBadge status={e.status} />
          </span>
        }
        subtitle={e.description}
        back="/accounting/journals"
        actions={
          manual && (
            <>
              {e.status === 'DRAFT' && (
                <>
                  <ConfirmButton variant="danger" message="Delete this draft?" onConfirm={() => remove.mutate()}>
                    <Trash2 className="size-4" /> Delete
                  </ConfirmButton>
                  <Button loading={postEntry.isPending} onClick={() => postEntry.mutate()}>
                    <BookCheck className="size-4" /> Post
                  </Button>
                </>
              )}
              {e.status === 'POSTED' && (
                <ConfirmButton variant="danger" message="Void this entry? It will be excluded from all reports." loading={voidEntry.isPending} onConfirm={() => voidEntry.mutate()}>
                  <Ban className="size-4" /> Void
                </ConfirmButton>
              )}
            </>
          )
        }
      />
      <Card>
        <DescriptionList
          items={[
            ['Date', date(e.date)],
            ['Reference', e.reference],
            [
              'Source',
              e.sourceId && sourceHref[e.sourceType] ? (
                <Link key="s" href={sourceHref[e.sourceType] + e.sourceId} className="text-indigo-600 dark:text-indigo-400 hover:underline">
                  {humanize(e.sourceType)}
                </Link>
              ) : (
                humanize(e.sourceType)
              ),
            ],
            ['Posted at', dateTime(e.postedAt)],
          ]}
        />
      </Card>
      <Card title="Lines" className="mt-4" padded={false}>
        <DataTable
          rows={e.lines}
          columns={[
            { key: 'account', header: 'Account', cell: (l) => <Link href={`/accounting/reports?tab=ledger&accountId=${l.account.id}`} className="text-slate-900 dark:text-slate-100 hover:text-indigo-600">{l.account.code} · {l.account.name}</Link> },
            { key: 'memo', header: 'Memo', cell: (l) => l.description ?? '' },
            { key: 'debit', header: 'Debit', align: 'right', cell: (l) => (Number(l.debit) ? money(l.debit) : '') },
            { key: 'credit', header: 'Credit', align: 'right', cell: (l) => (Number(l.credit) ? money(l.credit) : '') },
          ]}
          footer={
            <tr className="font-semibold">
              <td className="px-4 py-2.5" colSpan={2}>
                Total
              </td>
              <td className="tabular px-4 py-2.5 text-right">{money(totalDebit)}</td>
              <td className="tabular px-4 py-2.5 text-right">{money(totalCredit)}</td>
            </tr>
          }
        />
      </Card>
    </>
  );
}
