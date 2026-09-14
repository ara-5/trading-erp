'use client';

import { FormEvent, useState } from 'react';
import { Button, Card, DescriptionList, Field, Input, PageHeader } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';

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
      </div>
    </>
  );
}
