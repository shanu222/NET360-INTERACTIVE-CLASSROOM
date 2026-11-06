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
  /** Error from a redirect sign-in that came back to the page. */
  authError: string | null;
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
/** Plain-language messages for the Firebase errors people actually hit. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const host = location.hostname;
  switch (code) {
    case 'auth/unauthorized-domain':
      return `This site (${host}) isn't allowed to sign in yet. In Firebase → Authentication → Settings → Authorized domains, add ${host}.`;
    case 'auth/operation-not-allowed':
      return 'Google sign-in is turned off. In Firebase → Authentication → Sign-in method, enable Google.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was closed before it finished. Try again.';
    case 'auth/network-request-failed':
      return 'No connection to Google. Check the internet and try again.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'The Firebase API key is wrong. Check VITE_FIREBASE_API_KEY on Vercel and redeploy.';
    default:
      return (e as Error)?.message?.replace(/^Firebase:\s*/, '') || 'Sign-in failed. Try again.';
  }
}

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
  const [fb, setFb] = useState<{ app: FirebaseApp; auth: Auth; mod: typeof import('firebase/auth') } | null>(null);
  const [fbUser, setFbUser] = useState<FbUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

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
        // Load the whole auth module now, so the sign-in button can open the
        // Google popup synchronously on click (browsers block late popups).
        const mod = await import('firebase/auth');
        const app = initializeApp(fbConfig);
        const auth = mod.getAuth(app);
        setFb({ app, auth, mod });
        // Finish a redirect sign-in (fallback path) and surface its errors.
        mod.getRedirectResult(auth).catch((e) => setAuthError(authMessage(e)));
        unsub = mod.onAuthStateChanged(auth, (u) => {
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

  /**
   * Must be called directly from a click handler, with nothing awaited before it:
   * the popup opens synchronously. If the browser still blocks popups (some mobile
   * browsers and in-app browsers do), fall back to a full-page redirect.
   */
  const signInWithGoogle = useCallback((): Promise<void> => {
    if (!fb) return Promise.reject(new Error('Sign-in is still loading — try again in a moment.'));
    const provider = new fb.mod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return fb.mod
      .signInWithPopup(fb.auth, provider)
      .then(() => undefined)
      .catch((e: { code?: string }) => {
        if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-environment') {
          return fb.mod.signInWithRedirect(fb.auth, provider);
        }
        throw new Error(authMessage(e));
      });
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
    if (fb) await fb.mod.signOut(fb.auth);
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
    () => ({ ready, mode, media, user, headers, socketAuth, signInWithGoogle, authError, signInDev, signOut }),
    [ready, mode, media, user, headers, socketAuth, signInWithGoogle, authError, signInDev, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
