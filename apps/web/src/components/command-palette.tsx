'use client';

import { CornerDownLeft, FilePlus2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { nav, NavItem } from '@/components/shell';
import { useAuth } from '@/lib/auth';

interface Action {
  href: string;
  label: string;
  group: string;
  icon: NavItem['icon'];
  keywords?: string;
}

const quickActions: Omit<Action, 'group'>[] = [
  { href: '/sales/invoices/new', label: 'New sales invoice', icon: FilePlus2, keywords: 'bill customer' },
  { href: '/sales/orders/new', label: 'New sales order', icon: FilePlus2 },
  { href: '/sales/quotations/new', label: 'New quotation', icon: FilePlus2, keywords: 'quote' },
  { href: '/purchasing/orders/new', label: 'New purchase order', icon: FilePlus2, keywords: 'po supplier' },
  { href: '/purchasing/bills/new', label: 'New purchase bill', icon: FilePlus2, keywords: 'expense supplier' },
  { href: '/accounting/journals/new', label: 'New journal entry', icon: FilePlus2, keywords: 'gl posting' },
];

/** Simple subsequence + substring scorer — good enough for a short, hand-picked action list. */
function score(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) if (t[ti] === q[qi]) qi++;
  return qi === q.length ? 10 : 0;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { hasRole } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<Action[]>(() => {
    const navActions = nav
      .filter((s) => hasRole(...s.roles))
      .flatMap((s) => s.items.map((item) => ({ ...item, group: 'Go to' })));
    const quick = quickActions.filter((a) => hasRole('SALES', 'PURCHASING', 'ACCOUNTANT')).map((a) => ({ ...a, group: 'Create' }));
    return [...navActions, ...quick];
  }, [hasRole]);

  const results = useMemo(() => {
    if (!query.trim()) return actions;
    return actions
      .map((a) => ({ a, s: Math.max(score(query, a.label), score(query, a.keywords ?? '')) }))
      .filter((r) => r.s > 0)
      .sort((x, y) => y.s - x.s)
      .map((r) => r.a);
  }, [actions, query]);

  useEffect(() => setIndex(0), [query, open]);
  useEffect(() => {
    if (open) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function go(href: string) {
    router.push(href);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[index]) {
      e.preventDefault();
      go(results[index].href);
    }
  }

  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <Search className="size-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page or create something…"
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <kbd className="rounded border border-slate-200 px-1 font-mono text-[10px] text-slate-400 dark:border-slate-700 dark:text-slate-500">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No matches</p>}
          {results.map((r, i) => {
            const showGroup = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <div key={r.href + r.label}>
                {showGroup && <p className="mb-1 mt-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{r.group}</p>}
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(r.href)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                    i === index ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <r.icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{r.label}</span>
                  {i === index && <CornerDownLeft className="size-3.5 text-slate-400" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
