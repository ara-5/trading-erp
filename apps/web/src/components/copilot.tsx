'use client';

import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiStream, readEvents } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, humanize } from '@/lib/format';
import { useGet } from '@/lib/hooks';
import { Button, Spinner, Textarea } from './ui';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = ["What's overdue right now?", 'Any products low on stock?', "How's this month looking?", 'Any leave requests waiting on me?'];

/**
 * A floating chat widget wired to the AI copilot (`/copilot/chat`, server-sent events). It only ever asks
 * questions — every tool on the backend is read-only, so nothing here can create, post, or change data.
 */
export function Copilot() {
  const { user } = useAuth();
  const status = useGet<{ configured: boolean; dailyRemaining: number }>(user ? '/copilot/status' : null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, activeTool]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!user) return null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || streaming) return;
    const history = [...messages, { role: 'user' as const, content: question }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    setActiveTool(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const appendToAssistant = (chunk: string) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + chunk };
        return next;
      });

    try {
      const stream = await apiStream('/copilot/chat', { body: { messages: history }, signal: controller.signal });
      for await (const evt of readEvents(stream)) {
        if (evt.event === 'token') appendToAssistant((evt.data as { text: string }).text);
        else if (evt.event === 'tool') setActiveTool(humanize((evt.data as { name: string }).name));
        else if (evt.event === 'tool_result') setActiveTool(null);
        else if (evt.event === 'error') appendToAssistant(`\n\n⚠️ ${(evt.data as { message: string }).message}`);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) appendToAssistant('\n\n⚠️ Lost the connection to the copilot.');
    } finally {
      setStreaming(false);
      setActiveTool(null);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close AI copilot' : 'Open AI copilot'}
        className="fixed bottom-5 right-5 z-40 flex size-13 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30 transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(640px,calc(100vh-2.5rem))] sm:w-96">
          <div className="flex h-full flex-col overflow-hidden rounded-none bg-white shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl">
            <header className="flex items-center gap-2.5 border-b border-slate-100 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-white">
              <div className="flex size-8 items-center justify-center rounded-full bg-white/15">
                <Bot className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">ERP Copilot</p>
                <p className="text-xs text-indigo-100">Answers from live data — read-only</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-white/15 sm:hidden" aria-label="Close">
                <X className="size-5" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {status.isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              ) : !status.data?.configured ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-slate-500">
                  <Bot className="size-8 text-slate-300" />
                  <p className="font-medium text-slate-700">Copilot isn&apos;t configured</p>
                  <p>Set <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">ANTHROPIC_API_KEY</code> on the API to enable it.</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col justify-end gap-2 px-1">
                  <p className="mb-1 text-xs font-medium text-slate-500">Try asking:</p>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100">
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm',
                        m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800',
                      )}
                    >
                      {m.content || (streaming && i === messages.length - 1 && <Loader2 className="size-4 animate-spin" />)}
                    </div>
                  </div>
                ))
              )}
              {activeTool && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 className="size-3 animate-spin" /> Checking {activeTool.toLowerCase()}…
                </div>
              )}
            </div>

            <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-slate-100 p-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={status.data?.configured ? 'Ask about sales, stock, invoices…' : 'Copilot is not configured'}
                disabled={!status.data?.configured}
                rows={1}
                className="max-h-24 resize-none py-2"
              />
              <Button type="submit" size="sm" disabled={!input.trim() || streaming || !status.data?.configured} className="h-9 shrink-0">
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
