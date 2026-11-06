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
