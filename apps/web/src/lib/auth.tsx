'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, post, refreshAccessToken, session } from './api';

export type Role = 'ADMIN' | 'ACCOUNTANT' | 'SALES' | 'INVENTORY' | 'PURCHASING' | 'HR' | 'VIEWER';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
}

export type LoginResult = { twoFactorRequired: false; user: User } | { twoFactorRequired: true; challenge: string };

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyTwoFactor: (challenge: string, code: string) => Promise<User>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const off = session.onChange((u) => setUser(u as User | null));
    // Restore the session from the refresh cookie on first load.
    refreshAccessToken().finally(() => setLoading(false));
    return () => {
      off();
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const res = await api<{ twoFactorRequired: boolean; challenge?: string; accessToken?: string; user?: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (res.twoFactorRequired) return { twoFactorRequired: true, challenge: res.challenge! };
    session.set(res.accessToken!, res.user!);
    return { twoFactorRequired: false, user: res.user! };
  }, []);

  const verifyTwoFactor = useCallback(async (challenge: string, code: string) => {
    const res = await post<{ accessToken: string; user: User }>('/auth/2fa/verify-login', { challenge, code });
    session.set(res.accessToken, res.user);
    return res.user;
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await api<User>('/auth/me');
    session.set(session.token, u);
  }, []);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    session.set(null, null);
    window.location.href = '/login';
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await post<{ accessToken: string; user: User }>('/auth/change-password', { currentPassword, newPassword });
    session.set(res.accessToken, res.user);
  }, []);

  const hasRole = useCallback(
    (...roles: Role[]) => !!user && (user.role === 'ADMIN' || roles.length === 0 || roles.includes(user.role)),
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyTwoFactor, logout, changePassword, refreshUser, hasRole }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
