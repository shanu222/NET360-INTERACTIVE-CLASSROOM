/**
 * The class code a student entered on the join card. The server lets students in
 * only with it, so the classroom page sends it when connecting.
 */
const key = (sessionId: string) => `n360.code.${sessionId}`;

export function rememberCode(sessionId: string, code: string) {
  try {
    localStorage.setItem(key(sessionId), code);
  } catch {
    /* private mode */
  }
}

export function codeFor(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  try {
    return localStorage.getItem(key(sessionId));
  } catch {
    return null;
  }
}

/** The name a student joins with (remembered for next time). */
export function rememberName(name: string) {
  try {
    localStorage.setItem('n360.name', name);
  } catch {
    /* private mode */
  }
}
export function lastName(): string {
  try {
    return localStorage.getItem('n360.name') ?? '';
  } catch {
    return '';
  }
}

/** A random secret that identifies this device's student between reloads. */
export function guestKey(): string {
  try {
    let k = localStorage.getItem('n360.guestKey');
    if (!k) {
      const a = new Uint8Array(18);
      crypto.getRandomValues(a);
      k = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('n360.guestKey', k);
    }
    return k;
  } catch {
    return (window as unknown as { __n360k?: string }).__n360k ??= Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}
