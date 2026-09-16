'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeState {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const STORAGE_KEY = 'erp-theme';

function apply(preference: ThemePreference): 'light' | 'dark' {
  const resolved = preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  return resolved;
}

/** Inline script text, injected before hydration in the root layout so there's no light-mode flash. */
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var p = localStorage.getItem('${STORAGE_KEY}') || 'system';
    var dark = p === 'dark' || (p === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    let stored: ThemePreference = 'system';
    try {
      stored = (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system';
    } catch {
      // Private-browsing / storage-blocked — fall back to system.
    }
    setPreferenceState(stored);
    setResolved(apply(stored));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => stored === 'system' && setResolved(apply('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    setResolved(apply(p));
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // Ignore — the choice just won't persist across reloads.
    }
  }, []);

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
