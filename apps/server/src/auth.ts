import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Request } from 'express';
import { authMode, config } from './config.ts';

export interface User {
  uid: string;
  name: string;
  email?: string;
}

let app: App | null = null;
if (authMode === 'firebase') {
  app = initializeApp(
    config.firebase.serviceAccountJson
      ? { credential: cert(JSON.parse(config.firebase.serviceAccountJson)), projectId: config.firebase.projectId }
      : { projectId: config.firebase.projectId },
  );
}

/**
 * Resolve a user from a Firebase ID token (production) or a dev identity
 * (only when the server runs without Firebase configured).
 */
export async function verifyUser(idToken?: string, dev?: { uid?: string; name?: string }): Promise<User | null> {
  if (authMode === 'firebase') {
    if (!idToken || !app) return null;
    try {
      const t = await getAuth(app).verifyIdToken(idToken);
      return { uid: t.uid, name: (t.name as string) || t.email?.split('@')[0] || 'Student', email: t.email };
    } catch {
      return null;
    }
  }
  if (dev?.uid && dev.name) {
    return { uid: `dev:${String(dev.uid).slice(0, 40)}`, name: String(dev.name).slice(0, 60) };
  }
  return null;
}

/** Read the caller from `Authorization: Bearer <idToken>` or the dev header. */
export async function userFromRequest(req: Request): Promise<User | null> {
  const h = req.headers.authorization;
  const idToken = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  let dev: { uid?: string; name?: string } | undefined;
  const devHeader = req.headers['x-dev-user'];
  if (typeof devHeader === 'string') {
    try {
      dev = JSON.parse(decodeURIComponent(devHeader));
    } catch {
      /* ignore */
    }
  }
  return verifyUser(idToken, dev);
}

export function mayTeach(u: User): boolean {
  if (!config.teacherEmails.length) return true;
  return Boolean(u.email && config.teacherEmails.includes(u.email.toLowerCase()));
}
