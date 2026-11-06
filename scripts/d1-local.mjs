/**
 * A local stand-in for the Cloudflare D1 HTTP API, backed by SQLite — for testing
 * persistence without a Cloudflare account. Same request and response shape as
 *   POST /client/v4/accounts/:account/d1/database/:db/query  { sql, params }
 *
 *   node scripts/d1-local.mjs [port] [file.sqlite]
 *   CLOUDFLARE_API_BASE=http://localhost:8787 CLOUDFLARE_ACCOUNT_ID=x CLOUDFLARE_D1_DATABASE_ID=x CLOUDFLARE_API_TOKEN=x npm start
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.argv[2] ?? 8787);
const db = new DatabaseSync(process.argv[3] ?? ':memory:');

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
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
