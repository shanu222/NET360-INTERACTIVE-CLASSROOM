import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User as FbUser } from 'firebase/auth';
import { apiPath } from './env.ts';

/**
 * Sign-in for NET360 Classroom.
 *  - Production: Firebase Auth (Google sign-in), the server verifies the ID token.
 *  - Local development without Firebase: a name is enough (the server runs in dev mode).
 * The mode comes from the server's /api/config so client and server always agree.
 */

export interface Identity {
  uid: string;
  name: string;
  email?: string;
}

interface AuthCtx {
  ready: boolean;
  mode: 'firebase' | 'dev';
  media: boolean;
  user: Identity | null;
  /** Headers for REST calls. */
  headers: () => Promise<Record<string, string>>;
  /** Credentials for the socket handshake. */
  socketAuth: () => Promise<{ idToken?: string; dev?: { uid: string; name: string } }>;
  signInWithGoogle: () => Promise<void>;
  signInDev: (name: string) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const fbConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

// Dev identity: the uid lives per browser tab, so a teacher tab and a student tab
// on the same laptop act as different people; the name is remembered.
const DEV_UID = 'n360.dev.uid';
const DEV_NAME = 'n360.dev.name';
function readDev(): Identity | null {
  const uid = sessionStorage.getItem(DEV_UID);
  const name = localStorage.getItem(DEV_NAME);
  return uid && name ? { uid, name } : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'firebase' | 'dev'>('dev');
  const [media, setMedia] = useState(false);
  const [user, setUser] = useState<Identity | null>(null);
  const [fb, setFb] = useState<{ app: FirebaseApp; auth: Auth } | null>(null);
  const [fbUser, setFbUser] = useState<FbUser | null>(null);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      let cfg = { authMode: 'dev' as 'firebase' | 'dev', media: false };
      try {
        cfg = await (await fetch(apiPath('/api/config'))).json();
      } catch {
        /* server unreachable — UI shows errors later */
      }
      setMode(cfg.authMode);
      setMedia(cfg.media);
      if (cfg.authMode === 'firebase') {
        if (!fbConfig.apiKey) {
          console.error('Server expects Firebase sign-in, but VITE_FIREBASE_* is not set for the web app.');
          setReady(true);
          return;
        }
        const { initializeApp } = await import('firebase/app');
        const { getAuth, onAuthStateChanged } = await import('firebase/auth');
        const app = initializeApp(fbConfig);
        const auth = getAuth(app);
        setFb({ app, auth });
        unsub = onAuthStateChanged(auth, (u) => {
          setFbUser(u);
          setUser(u ? { uid: u.uid, name: u.displayName || u.email?.split('@')[0] || 'Student', email: u.email ?? undefined } : null);
          setReady(true);
        });
      } else {
        setUser(readDev());
        setReady(true);
      }
    })();
    return () => unsub();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!fb) return;
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    await signInWithPopup(fb.auth, new GoogleAuthProvider());
  }, [fb]);

  const signInDev = useCallback((name: string) => {
    let uid = sessionStorage.getItem(DEV_UID);
    if (!uid) {
      uid = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(DEV_UID, uid);
    }
    localStorage.setItem(DEV_NAME, name.trim());
    setUser({ uid, name: name.trim() });
  }, []);

  const signOut = useCallback(async () => {
    if (fb) {
      const { signOut: fbSignOut } = await import('firebase/auth');
      await fbSignOut(fb.auth);
    }
    sessionStorage.removeItem(DEV_UID);
    setUser(null);
  }, [fb]);

  const socketAuth = useCallback(async () => {
    if (mode === 'firebase') return { idToken: fbUser ? await fbUser.getIdToken() : undefined };
    return user ? { dev: { uid: user.uid, name: user.name } } : {};
  }, [mode, fbUser, user]);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const a = await socketAuth();
    if (a.idToken) return { Authorization: `Bearer ${a.idToken}` };
    if (a.dev) return { 'X-Dev-User': encodeURIComponent(JSON.stringify(a.dev)) };
    return {};
  }, [socketAuth]);

  const value = useMemo(
    () => ({ ready, mode, media, user, headers, socketAuth, signInWithGoogle, signInDev, signOut }),
    [ready, mode, media, user, headers, socketAuth, signInWithGoogle, signInDev, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
