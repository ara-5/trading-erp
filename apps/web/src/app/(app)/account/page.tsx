'use client';

import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import Image from 'next/image';
import { FormEvent, useState } from 'react';
import { Badge, Button, Card, DescriptionList, Field, Input, Modal, PageHeader } from '@/components/ui';
import { errorMessage, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';

function TwoFactorCard() {
  const { user, refreshUser } = useAuth();
  const [stage, setStage] = useState<'idle' | 'setup' | 'recovery'>('idle');
  const [setup, setSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await post<{ secret: string; qrCodeDataUrl: string }>('/auth/2fa/setup'));
      setStage('setup');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code });
      setRecoveryCodes(res.recoveryCodes);
      setStage('recovery');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function finishRecovery() {
    setStage('idle');
    setSetup(null);
    setCode('');
    setRecoveryCodes([]);
    await refreshUser();
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post('/auth/2fa/disable', { password });
      setPassword('');
      await refreshUser();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;
  return (
    <Card
      title="Two-factor authentication"
      actions={user.twoFactorEnabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="gray">Disabled</Badge>}
    >
      {user.twoFactorEnabled ? (
        <form onSubmit={disable} className="max-w-sm space-y-3">
          <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            Your account is protected with an authenticator app. Disabling it removes that extra check on sign-in.
          </p>
          <Field label="Confirm your password to disable">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}
          <Button type="submit" variant="danger" loading={busy}>
            <ShieldOff className="size-4" /> Disable 2FA
          </Button>
        </form>
      ) : (
        <div className="max-w-sm space-y-3">
          <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-slate-400" />
            Add a second step to sign-in using any authenticator app (Google Authenticator, 1Password, Authy…).
          </p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}
          <Button onClick={startSetup} loading={busy}>
            Set up two-factor authentication
          </Button>
        </div>
      )}

      <Modal open={stage === 'setup'} onClose={() => setStage('idle')} title="Scan this QR code" size="sm">
        {setup && (
          <form onSubmit={confirmSetup} className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">Scan with your authenticator app, then enter the 6-digit code it shows.</p>
            <div className="flex justify-center">
              <Image src={setup.qrCodeDataUrl} alt="2FA QR code" width={200} height={200} unoptimized className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-800" />
            </div>
            <p className="break-all rounded-lg bg-slate-50 px-3 py-2 text-center text-xs font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {setup.secret}
            </p>
            <Field label="6-digit code">
              <Input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
            </Field>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}
            <Button type="submit" loading={busy} className="w-full">
              Confirm & enable
            </Button>
          </form>
        )}
      </Modal>

      <Modal open={stage === 'recovery'} onClose={finishRecovery} title="Save your recovery codes" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Each code can be used once to sign in if you lose access to your authenticator app. Save them somewhere safe — they won&apos;t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm dark:bg-slate-800">
            {recoveryCodes.map((c) => (
              <span key={c} className="text-slate-700 dark:text-slate-200">
                {c}
              </span>
            ))}
          </div>
          <Button onClick={finishRecovery} className="w-full">
            I&apos;ve saved these codes
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

export default function AccountPage() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrent('');
      setNew('');
      setConfirm('');
      setSuccess(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;
  return (
    <>
      <PageHeader title="My account" />
      <div className="grid max-w-2xl gap-6">
        <Card title="Profile">
          <DescriptionList
            items={[
              ['Name', user.name],
              ['Email', user.email],
              ['Role', humanize(user.role)],
            ]}
          />
        </Card>
        <Card title="Change password">
          <form onSubmit={onSubmit} className="max-w-sm space-y-4">
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 10 characters">
              <Input type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Password updated.</p>}
            <Button type="submit" loading={submitting}>
              Update password
            </Button>
          </form>
        </Card>
        <TwoFactorCard />
      </div>
    </>
  );
}
