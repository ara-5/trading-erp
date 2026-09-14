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
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } });
    session.set(res.accessToken, res.user);
    return res.user;
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

  return <AuthContext.Provider value={{ user, loading, login, logout, changePassword, hasRole }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
