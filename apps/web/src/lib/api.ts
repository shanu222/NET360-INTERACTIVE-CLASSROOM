import type { SessionInfo } from '@net360/protocol';
import { apiPath } from './env.ts';

async function call<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiPath(path), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new Error('Cannot reach the classroom server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  startClass: (headers: Record<string, string>, subject: string, topic: string) =>
    call<{ session: SessionInfo; boardKey: string; padKey: string }>('/api/sessions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ subject, topic }),
    }),
  owner: (headers: Record<string, string>, id: string) =>
    call<{ session: SessionInfo; boardKey: string; padKey: string }>(`/api/sessions/${id}/owner`, { headers }),
  lookup: (code: string) => call<{ session: SessionInfo; present: number }>(`/api/join/${encodeURIComponent(code)}`),
};

/** Join and board links always point at the web app (this origin), not the API server. */
export const joinUrl = (code: string) => `${location.origin}/join?code=${code}`;
export const boardUrl = (sessionId: string, key: string) => `${location.origin}/board/${sessionId}?k=${key}`;
export const padUrl = (sessionId: string, key: string) => `${location.origin}/pad/${sessionId}?k=${key}`;
