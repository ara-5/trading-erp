'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { Copilot } from '@/components/copilot';
import { ForcedPasswordChange } from '@/components/forced-password-change';
import { Shell } from '@/components/shell';
import { Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) return <Loading />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return (
    <Shell>
      {children}
      <Copilot />
    </Shell>
  );
}
