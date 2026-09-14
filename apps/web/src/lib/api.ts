/**
 * API client. The access token lives only in memory; the refresh token is an httpOnly cookie scoped to
 * /api/auth, so it's never readable by scripts. Requests go through the Next.js `/api` proxy (same origin),
 * and a 401 triggers one silent refresh + retry before the user is sent to the login page.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

type Query = Record<string, string | number | boolean | null | undefined>;
type SessionUser = { id: string; email: string; name: string; role: string; mustChangePassword: boolean };

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
const sessionListeners = new Set<(user: SessionUser | null) => void>();

export const session = {
  get token() {
    return accessToken;
  },
  set(token: string | null, user?: SessionUser | null) {
    accessToken = token;
    if (user !== undefined) sessionListeners.forEach((l) => l(user));
  },
  onChange(listener: (user: SessionUser | null) => void) {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
  },
};

const resolve = (path: string, query?: Query) => {
  const base = API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`;
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url;
};

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshAccessToken(): Promise<string | null> {
  refreshing ??= fetch(resolve('/auth/refresh'), { method: 'POST', credentials: 'include' })
    .then(async (res) => (res.ok ? ((await res.json()) as { accessToken: string; user: SessionUser }) : null))
    .catch(() => null)
    .then((data) => {
      session.set(data?.accessToken ?? null, data?.user ?? null);
      return data?.accessToken ?? null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send(path: string, init: { method?: string; body?: unknown; query?: Query; raw?: boolean }, retry = true): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(resolve(path, init.query), {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: {
      ...(isForm || init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshAccessToken()) return send(path, init, false);
    session.set(null, null);
    if (window.location.pathname !== '/login') window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, message, data?.errors);
  }
  return data as T;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  return parse<T>(await send(path, init));
}

/** Authenticated streaming request (used for Server-Sent Events such as the copilot and live updates). */
export async function apiStream(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) {
  let res = await fetch(resolve(path), {
    method: init.method ?? 'POST',
    credentials: 'include',
    signal: init.signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401 && (await refreshAccessToken())) {
    res = await fetch(resolve(path), {
      method: init.method ?? 'POST',
      credentials: 'include',
      signal: init.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${accessToken}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }
  if (!res.ok || !res.body) await parse(res);
  return res.body!;
}

/** Parses an SSE byte stream into `{ event, data }` messages. */
export async function* readEvents(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: JSON.parse(data.join('\n')) as unknown };
    }
  }
}

/** Fetches an authenticated PDF and opens it in a new tab. */
export async function openPdf(path: string) {
  const tab = window.open('', '_blank');
  const res = await send(path, { method: 'GET' });
  if (!res.ok) {
    tab?.close();
    await parse(res);
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.errors?.length) {
    return `${e.message}: ${e.errors.map((x) => (x.path ? `${x.path} – ${x.message}` : x.message)).join('; ')}`;
  }
  if (e instanceof TypeError) return 'Cannot reach the server. Is the API running?';
  return e instanceof Error ? e.message : 'Something went wrong';
}
