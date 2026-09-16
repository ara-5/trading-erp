'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type Toast = { id: number; type: 'success' | 'error'; message: string };
type Notify = (t: Omit<Toast, 'id'>) => void;

const ToastContext = createContext<Notify>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback<Notify>((t) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.type === 'error' ? 7000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-96">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex w-full items-start gap-2.5 rounded-lg bg-white dark:bg-slate-900 p-3 text-sm shadow-lg ring-1 ring-slate-200 dark:ring-slate-800"
          >
            {t.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
            )}
            <p className="text-slate-700 dark:text-slate-300">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
