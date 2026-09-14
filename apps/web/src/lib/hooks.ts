'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, Paged } from './api';
import { useToast } from './toast';

export function useGet<T>(path: string | null, query?: Record<string, string | number | boolean | undefined>) {
  return useQuery({
    queryKey: [path, query],
    queryFn: () => api<T>(path!, { query }),
    enabled: !!path,
  });
}

export function useList<T>(path: string, query: Record<string, string | number | boolean | undefined>) {
  return useQuery({
    queryKey: [path, query],
    queryFn: () => api<Paged<T>>(path, { query }),
    placeholderData: keepPreviousData,
  });
}

/** All options for a select: fetches a large page from paged endpoints or the raw array from simple ones. */
export function useOptions<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
  const q = useQuery({
    queryKey: [path, 'options', query],
    queryFn: async () => {
      const res = await api<Paged<T> | T[]>(path, { query: { pageSize: 200, ...query } });
      return Array.isArray(res) ? res : res.items;
    },
    staleTime: 30_000,
  });
  return q.data ?? [];
}

/** Runs a mutation, refreshes every query on success, and surfaces errors as toasts. */
export function useAction<TVars = void, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string; onSuccess?: (result: TResult) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await qc.invalidateQueries();
      if (opts.success) toast({ type: 'success', message: opts.success });
      opts.onSuccess?.(result);
    },
    onError: (e) => toast({ type: 'error', message: errorMessage(e) }),
  });
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useFields<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => setValues((v) => ({ ...v, [key]: value })), []);
  return [values, set, setValues] as const;
}
