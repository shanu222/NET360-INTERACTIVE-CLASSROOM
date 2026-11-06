/** All server configuration comes from environment variables (see .env.example). */
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  /** Public URL students open (used in join links). Falls back to the request origin. */
  publicUrl: env.PUBLIC_URL ?? '',

  firebase: {
    /** Firebase project id. When set, users must sign in with Firebase; dev identities are refused. */
    projectId: env.FIREBASE_PROJECT_ID ?? '',
    /** Optional service-account JSON (only needed for Firestore/Admin features beyond token checks). */
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT ?? '',
  },
  /**
   * Comma-separated Google accounts allowed to start classes and teach. With Firebase
   * sign-in on and nothing set, only the NET360 admin account may teach. (Local dev
   * without Firebase lets anyone teach.)
   */
  teacherEmails: (env.TEACHER_EMAILS || (env.FIREBASE_PROJECT_ID ? 'shahnawaz9974balouch@gmail.com' : ''))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  /**
   * LiveKit works the same for LiveKit Cloud and self-hosted LiveKit:
   *   Cloud:       LIVEKIT_URL=wss://<project>.livekit.cloud
   *   Self-hosted: LIVEKIT_URL=wss://livekit.your-domain.com (or ws://localhost:7880 with docker compose)
   */
  livekit: {
    url: env.LIVEKIT_URL ?? '',
    apiKey: env.LIVEKIT_API_KEY ?? '',
    apiSecret: env.LIVEKIT_API_SECRET ?? '',
  },

  /** Sessions with no activity for this long are removed from memory. */
  sessionIdleMs: Number(env.SESSION_IDLE_HOURS ?? 12) * 3600_000,

  /**
   * Web origins allowed to call this server, comma-separated.
   * e.g. ALLOWED_ORIGINS=https://classroom.net360.pk,https://net360-classroom.vercel.app
   * A leading "*." matches subdomains (e.g. *.vercel.app for preview deployments).
   * Empty = allow any origin (fine for local development only).
   */
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  /** Cloudflare D1 — sessions, attendance, hands and board snapshots. Optional. */
  d1: {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
    databaseId: env.CLOUDFLARE_D1_DATABASE_ID ?? '',
    apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
    /** Only for tests against a local stand-in of the D1 API. */
    apiBase: (env.CLOUDFLARE_API_BASE ?? 'https://api.cloudflare.com').replace(/\/+$/, ''),
  },
  /**
   * Cloudflare R2 — saved boards (any size) and lecture notes. Optional: without it,
   * boards are stored inside D1 rows (up to ~1.9 MB compressed per lecture).
   */
  r2: {
    bucket: env.R2_BUCKET ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    /** Defaults to https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com */
    endpoint: (env.R2_ENDPOINT || (env.CLOUDFLARE_ACCOUNT_ID ? `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` : '')).replace(/\/+$/, ''),
  },
  /** How often changed boards are snapshotted to the database. */
  snapshotEveryMs: Number(env.SNAPSHOT_EVERY_SECONDS ?? 3) * 1000,
};

/** Random per server start; clients that see it change take a fresh snapshot. */
export const epoch = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const dbEnabled = Boolean(config.d1.accountId && config.d1.databaseId && config.d1.apiToken);
export const r2Enabled = Boolean(config.r2.bucket && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.endpoint);

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin requests, curl, health checks
  if (!config.allowedOrigins.length) return true;
  let host = '';
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return config.allowedOrigins.some((p) => (p.startsWith('*.') ? host.endsWith(p.slice(1)) : p === origin));
}

export const authMode: 'firebase' | 'dev' = config.firebase.projectId ? 'firebase' : 'dev';
export const mediaEnabled = Boolean(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret);
