import type { SessionInfo } from '@net360/protocol';

async function call<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  startClass: (headers: Record<string, string>, subject: string, topic: string) =>
    call<{ session: SessionInfo; boardKey: string }>('/api/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject, topic }),
    }),
  owner: (headers: Record<string, string>, id: string) =>
    call<{ session: SessionInfo; boardKey: string }>(`/api/sessions/${id}/owner`, { headers }),
  lookup: (code: string) => call<{ session: SessionInfo; present: number }>(`/api/join/${encodeURIComponent(code)}`),
};

export const joinUrl = (code: string) => `${location.origin}/join?code=${code}`;
export const boardUrl = (sessionId: string, key: string) => `${location.origin}/board/${sessionId}?k=${key}`;
