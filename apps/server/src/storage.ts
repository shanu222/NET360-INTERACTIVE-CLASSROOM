import { AwsClient } from 'aws4fetch';
import { config, r2Enabled } from './config.ts';

/**
 * Cloudflare R2 through its S3-compatible API (signed with aws4fetch — no AWS SDK).
 * Used for saved boards, so a long lecture is never limited by a database row size.
 */
const client = r2Enabled
  ? new AwsClient({
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
      service: 's3',
      region: 'auto',
    })
  : null;

const url = (key: string) => `${config.r2.endpoint}/${config.r2.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

export async function putObject(key: string, body: Uint8Array, contentType = 'application/octet-stream') {
  if (!client) throw new Error('R2 is not configured');
  const res = await client.fetch(url(key), { method: 'PUT', body, headers: { 'Content-Type': contentType } });
  if (!res.ok) throw new Error(`R2 PUT ${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (!client) throw new Error('R2 is not configured');
  const res = await client.fetch(url(key), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Where a lecture's board lives in the bucket. */
export const boardKey = (sessionId: string) => `boards/${sessionId}.json.gz`;
