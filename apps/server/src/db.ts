import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config, dbEnabled } from './config.ts';

/**
 * Cloudflare D1 over its HTTP API — works from Railway (or anywhere) without a Worker.
 * https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
 */
const endpoint = () =>
  `${config.d1.apiBase}/client/v4/accounts/${config.d1.accountId}/d1/database/${config.d1.databaseId}/query`;

export async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!dbEnabled) return [];
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.d1.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message: string }[];
    result?: { results?: T[] }[];
  };
  if (!res.ok || !body.success) {
    throw new Error(`D1: ${body.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`}`);
  }
  return body.result?.[0]?.results ?? [];
}

/** Fire-and-forget write: a database hiccup must never interrupt a lesson. */
export function write(sql: string, params: unknown[] = []) {
  if (!dbEnabled) return;
  query(sql, params).catch((e) => console.error('[db]', (e as Error).message));
}

/** Apply db/schema.sql (idempotent: every statement is CREATE … IF NOT EXISTS). */
export async function migrate() {
  if (!dbEnabled) return;
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/schema.sql');
  const statements = readFileSync(file, 'utf8')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  for (const sql of statements) await query(sql);
}
