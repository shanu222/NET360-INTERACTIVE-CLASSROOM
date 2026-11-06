# Deploying NET360 Classroom

Three services, set up in this order:

| Piece | Host | What it does |
| --- | --- | --- |
| Database | **Cloudflare D1** | Sessions, attendance, raised hands (classes survive server restarts) |
| File storage | **Cloudflare R2** | Saved boards of any size (optional — without it boards are kept in D1 rows, up to ~1.9 MB each) |
| Realtime server | **Railway** | Socket.IO board sync, sign-in checks, LiveKit tokens |
| Web app | **Vercel** | The screens: home, join, student, teacher, classroom board |

Sign-in uses **Firebase Authentication** (Google). Class audio uses **LiveKit** (Cloud or self-hosted).

---

## 1. Cloudflare D1 (database)

1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database → Create**. Name it `net360-classroom`.
2. Open the database and copy its **Database ID**.
3. Copy your **Account ID** (shown on the account home page, right-hand side, and in the dashboard URL).
4. **My Profile → API Tokens → Create Token → Create Custom Token**:
   - Permissions: **Account · D1 · Edit**
   - Account Resources: your account
   - Create, then copy the token (it is shown once).

### R2 (saved boards)

1. **R2 Object Storage → Create bucket** → `net360classroom` (location: Asia-Pacific). Keep public access **off** — only the server reads it.
2. R2 → **Manage API Tokens → Create API token** → **Object Read & Write**, **Apply to specific buckets only** → `net360classroom`.
3. Copy the **Access Key ID** and **Secret Access Key** (S3 credentials) — the server uses those, not the token value.

You don't need to create tables — the server creates them on first start from `apps/server/db/schema.sql`. To do it by hand instead:
`npx wrangler d1 execute net360-classroom --remote --file apps/server/db/schema.sql`

## 2. Railway (realtime server)

1. Railway → **New Project → Deploy from GitHub repo** → `NET360-INTERACTIVE-CLASSROOM`. Leave Root Directory empty.
2. **Variables → Raw Editor** — paste and fill in:

   ```env
   RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile
   NODE_ENV=production
   CLOUDFLARE_ACCOUNT_ID=
   CLOUDFLARE_D1_DATABASE_ID=
   CLOUDFLARE_API_TOKEN=
   R2_BUCKET=net360classroom
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   SNAPSHOT_EVERY_SECONDS=3
   FIREBASE_PROJECT_ID=
   TEACHER_EMAILS=shahnawaz9974balouch@gmail.com
   ALLOWED_ORIGINS=
   ```

   Railway sets `PORT` itself — don't add it. `ALLOWED_ORIGINS` is filled in after step 3.
3. **Settings** — Railway's config-as-code is deprecated and new services ignore `railway.json`, so set these by hand:

   | Setting | Value |
   | --- | --- |
   | Source → Wait for CI | On |
   | Build → Watch Paths | leave **empty** (Railway then deploys every push; watch paths caused updates to be skipped) |
   | Deploy → Healthcheck Path | `/api/health` |
   | Deploy → Serverless | **Off** (a sleeping server drops live classes) |
   | Scale → Region | **Southeast Asia (Singapore)** — closest to Pakistan |
   | Scale → Replicas | **1** (never more: a second copy would split each class) |
   | Scale → Replica Limits | ~1 vCPU / 1 GB is plenty for many classes of 40 |

4. **Settings → Networking → Generate Domain**. If asked for a port, use the one in the deploy log (`NET360 Classroom server on :XXXX`, usually 8080).
5. Open `https://<your-app>.up.railway.app/api/health` → expect `"db":true`, `"r2":true`, `"auth":"firebase"`. The deploy log should say `R2 bucket "net360classroom" reachable`.

If the build log shows Railpack instead of Docker, set **Deploy → Custom Start Command** to `npm start` — that works too.

## 3. Vercel (web app)

1. Vercel → **Add New → Project** → import the same repository. Leave Root Directory as the repository root; `vercel.json` sets the build.
2. **Environment Variables**:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://<your-app>.up.railway.app` (no trailing slash) |
   | `VITE_FIREBASE_API_KEY` | Firebase → Project settings → Your apps → Web app |
   | `VITE_FIREBASE_AUTH_DOMAIN` | same place |
   | `VITE_FIREBASE_PROJECT_ID` | same place |
   | `VITE_FIREBASE_APP_ID` | same place |

3. **Deploy**, then copy the address (e.g. `https://net360-classroom.vercel.app`).
4. Back in Railway, set `ALLOWED_ORIGINS` to that address. Add any custom domain too, comma-separated:
   `https://net360-classroom.vercel.app,https://classroom.net360.pk`
   (`*.vercel.app` would also allow preview deployments, but also every other Vercel site — prefer exact addresses.)

`VITE_*` values are baked in at build time: after changing them, **redeploy** on Vercel.

## 4. Firebase (sign-in)

1. Firebase console → **Authentication → Sign-in method** → enable **Google**.
2. **Authentication → Settings → Authorized domains** → add your Vercel domain (and custom domain).

## 5. Check it

1. Open the Vercel address → **Start a class** → sign in with Google.
2. In the teacher console tap **Board** → that opens the classroom display; put it on the TV and press **Full screen**.
3. Scan the QR with a phone. Write on the board; it should appear on the phone instantly.
4. Optional: redeploy the Railway service mid-class. Screens show "Reconnecting…" for a few seconds and come back with the board intact.

## Custom domain (optional)

- Vercel → Project → **Settings → Domains** → add e.g. `classroom.net360.pk`.
- Railway → Service → **Settings → Networking → Custom Domain** → e.g. `api.classroom.net360.pk`; then update `VITE_API_URL` (and redeploy Vercel) and `ALLOWED_ORIGINS`.
- Add the new web domain to Firebase authorized domains.

## Class audio — LiveKit

The teacher speaks to the whole class; students speak only when the teacher lets them
(one by one, or everyone), and the teacher can mute anyone or everyone. LiveKit enforces
these permissions, so a student's app can't get around a mute. Students can also silence
the class on their own device.

Add to Railway → Variables, then redeploy:

| Variable | Value |
|---|---|
| `LIVEKIT_URL` | `wss://<your-project>.livekit.cloud` |
| `LIVEKIT_API_KEY` | from LiveKit Cloud → Settings → Keys |
| `LIVEKIT_API_SECRET` | from the same key |

- **LiveKit Cloud** (recommended): create a free project at cloud.livekit.io, then
  Settings → Keys → create a key. Copy the project URL and the key + secret.
- **Self-hosted** (cheapest for regular classes, no minute limits): one small Ubuntu
  server + a subdomain. Run `deploy/livekit/setup.sh` on it; it prints the three values
  for Railway. Step-by-step: [deploy/livekit/README.md](deploy/livekit/README.md).
  (Railway can't host LiveKit itself: it needs its own UDP ports.)

Check: `/api/health` shows `"audio": true`. Until these are set, the audio buttons stay hidden.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Cannot reach the classroom server" | `VITE_API_URL` is wrong or missing — fix it on Vercel and redeploy |
| Works in Postman but not the browser (CORS) | Add the exact web address to `ALLOWED_ORIGINS` on Railway — scheme included, no trailing slash |
| Google sign-in popup closes with an error | Add the domain to Firebase **Authorized domains** |
| "Please sign in to join" after Google sign-in | `FIREBASE_PROJECT_ID` on Railway doesn't match `VITE_FIREBASE_PROJECT_ID` on Vercel |
| `/api/health` shows `"db":false` | One of the three `CLOUDFLARE_*` variables is missing on Railway |
| `/api/health` shows `"r2":false` | `R2_BUCKET`, `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY` is missing |
| Log: `[r2] check failed … HTTP 403` | Wrong R2 keys, or the R2 token isn't allowed on this bucket (boards are kept in D1 meanwhile) |
| Log: `[db] D1: Authentication error` | The API token lacks **Account · D1 · Edit** or belongs to another account |
| Students on phones can't use the in-app scanner | Needs HTTPS — fine on Vercel. Phone camera apps can always scan the QR |

## Test locally before deploying

```bash
npm ci
npm run build && npm start            # one process, http://localhost:4000
npm run loadtest                      # 40 students in sync (server must be running)
npm run test:restart                  # class survives a mid-lesson restart (uses a local D1 stand-in)
```

To try the split setup locally: run the server with `ALLOWED_ORIGINS=http://localhost:4173 npm start`, build the web app with `VITE_API_URL=http://localhost:4000 npm run build`, then `cd apps/web && npx vite preview --port 4173`.
