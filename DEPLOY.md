# Deploying NET360 Classroom

Three services, set up in this order:

| Piece | Host | What it does |
| --- | --- | --- |
| Database | **Cloudflare D1** | Sessions, attendance, raised hands, board snapshots (classes survive server restarts) |
| Realtime server | **Railway** | Socket.IO board sync, sign-in checks, LiveKit tokens |
| Web app | **Vercel** | The screens: home, join, student, teacher, classroom board |

Sign-in uses **Firebase Authentication** (Google). Video later uses **LiveKit** (Cloud or self-hosted).

---

## 1. Cloudflare D1 (database)

1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database → Create**. Name it `net360-classroom`.
2. Open the database and copy its **Database ID**.
3. Copy your **Account ID** (shown on the account home page, right-hand side, and in the dashboard URL).
4. **My Profile → API Tokens → Create Token → Create Custom Token**:
   - Permissions: **Account · D1 · Edit**
   - Account Resources: your account
   - Create, then copy the token (it is shown once).

You don't need to create tables — the server creates them on first start from `apps/server/db/schema.sql`. To do it by hand instead:
`npx wrangler d1 execute net360-classroom --remote --file apps/server/db/schema.sql`

## 2. Railway (realtime server)

1. Railway → **New Project → Deploy from GitHub repo** → `NET360-INTERACTIVE-CLASSROOM`.
   `railway.json` tells Railway to build `apps/server/Dockerfile`; leave Root Directory empty.
2. **Variables** — add:

   | Variable | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | from step 1 |
   | `CLOUDFLARE_D1_DATABASE_ID` | from step 1 |
   | `CLOUDFLARE_API_TOKEN` | from step 1 |
   | `FIREBASE_PROJECT_ID` | your Firebase project id |
   | `TEACHER_EMAILS` | optional: `teacher1@gmail.com,teacher2@gmail.com` |
   | `ALLOWED_ORIGINS` | set in step 3 once you know the Vercel address |

   Railway sets `PORT` itself — don't add it.
3. **Settings → Networking → Generate Domain**. If Railway asks for a port, use the one the deploy log prints (`NET360 Classroom server on :XXXX`).
4. Open `https://<your-app>.up.railway.app/api/health`. You should see `"db":true` and `"auth":"firebase"`.
5. Keep the service at **1 replica**. Live classes are held in this one process; D1 snapshots let them survive restarts and redeploys, but two replicas would split a class in half.

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

## Video (Phase 4) — LiveKit

Add to Railway: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- **LiveKit Cloud** (recommended for the pilot): create a project at cloud.livekit.io; `LIVEKIT_URL=wss://<project>.livekit.cloud`.
- **Self-hosted**: run LiveKit on your own server (it needs its own UDP ports and TLS — Railway is not a good fit for the media server itself); point `LIVEKIT_URL` at it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Cannot reach the classroom server" | `VITE_API_URL` is wrong or missing — fix it on Vercel and redeploy |
| Works in Postman but not the browser (CORS) | Add the exact web address to `ALLOWED_ORIGINS` on Railway — scheme included, no trailing slash |
| Google sign-in popup closes with an error | Add the domain to Firebase **Authorized domains** |
| "Please sign in to join" after Google sign-in | `FIREBASE_PROJECT_ID` on Railway doesn't match `VITE_FIREBASE_PROJECT_ID` on Vercel |
| `/api/health` shows `"db":false` | One of the three `CLOUDFLARE_*` variables is missing on Railway |
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
