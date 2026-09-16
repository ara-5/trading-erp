'use client';

import { ShieldAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Field, Input } from './ui';

/** Blocks the app behind a mandatory password change for accounts created (or reset) by an admin. */
export function ForcedPasswordChange() {
  const { changePassword, logout } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">Choose a new password</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your account was set up with a temporary password. Pick your own before continuing.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <Field label="Temporary password">
            <Input type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </Field>
          <Field label="New password" hint="At least 10 characters">
            <Input type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(e) => setNew(e.target.value)} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}
          <Button type="submit" loading={submitting} className="w-full">
            Set password &amp; continue
          </Button>
          <button type="button" onClick={logout} className="w-full text-center text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            Sign out instead
          </button>
        </form>
      </div>
    </main>
  );
}
