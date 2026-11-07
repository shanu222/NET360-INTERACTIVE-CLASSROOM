/**
 * A local stand-in for Cloudflare D1 (HTTP API, backed by SQLite) and R2 (S3 PUT/GET,
 * in memory) — for testing persistence without a Cloudflare account. Same shapes as
 *   POST /client/v4/accounts/:account/d1/database/:db/query  { sql, params }
 *   PUT | GET /:bucket/:key
 *
 *   node scripts/d1-local.mjs [port] [file.sqlite]
 *   CLOUDFLARE_API_BASE=http://localhost:8787 CLOUDFLARE_ACCOUNT_ID=x CLOUDFLARE_D1_DATABASE_ID=x CLOUDFLARE_API_TOKEN=x npm start
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.argv[2] ?? 8787);
const db = new DatabaseSync(process.argv[3] ?? ':memory:');

const objects = new Map();

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    // R2 stand-in: PUT / GET /<bucket>/<key> (S3 path style; signatures are not checked).
    if (!(req.url ?? '').includes('/d1/database/')) {
      if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256')) return send(403, { error: 'unsigned' });
      if (req.method === 'PUT') {
        objects.set(req.url, Buffer.concat(chunks));
        res.writeHead(200);
        return res.end();
      }
      if (req.method === 'DELETE') {
        objects.delete(req.url);
        res.writeHead(204);
        return res.end();
      }
      // ListObjectsV2: GET /<bucket>?list-type=2&prefix=…
      const u = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && u.searchParams.get('list-type') === '2') {
        const base = `${u.pathname}/`;
        const prefix = u.searchParams.get('prefix') ?? '';
        const keys = [...objects.keys()].filter((k) => k.startsWith(base + prefix)).map((k) => decodeURIComponent(k.slice(base.length)));
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`);
      }
      if (req.method === 'GET') {
        const o = objects.get(req.url);
        res.writeHead(o ? 200 : 404);
        return res.end(o ?? '');
      }
      return send(405, {});
    }
    if (req.method !== 'POST' || !/\/d1\/database\/[^/]+\/query$/.test(req.url ?? '')) return send(404, { success: false, errors: [{ message: 'not found' }] });
    if (!req.headers.authorization?.startsWith('Bearer ')) return send(401, { success: false, errors: [{ message: 'unauthorized' }] });
    try {
      const { sql, params = [] } = JSON.parse(body);
      const stmt = db.prepare(sql);
      const isRead = /^\s*(select|with|pragma)/i.test(sql);
      const results = isRead ? stmt.all(...params) : (stmt.run(...params), []);
      send(200, { success: true, errors: [], result: [{ results, success: true, meta: {} }] });
    } catch (e) {
      send(400, { success: false, errors: [{ message: e.message }] });
    }
  });
}).listen(port, () => console.log(`D1 stand-in on :${port}`));
