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
  /** Comma-separated emails allowed to start classes. Empty = any signed-in user. */
  teacherEmails: (env.TEACHER_EMAILS ?? '')
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
};

export const authMode: 'firebase' | 'dev' = config.firebase.projectId ? 'firebase' : 'dev';
export const mediaEnabled = Boolean(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret);
