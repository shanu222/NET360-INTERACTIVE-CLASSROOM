import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { GoogleMark } from './Lobby.tsx';

/**
 * Sign-in for hosts: Google accounts (the first sign-in creates the account).
 * A plain name field appears only on a local test server.
 */
export function SignIn({ prompt }: { prompt?: string }) {
  const { mode, signInWithGoogle, signInDev, authError } = useAuth();
  const [devName, setDevName] = useState(localStorage.getItem('n360.dev.name') ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (mode !== 'firebase') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      if (devName.trim().length >= 2) signInDev(devName);
    };
    return (
      <form className="signin" onSubmit={submit}>
        {prompt && <p className="signin__prompt">{prompt}</p>}
        <label className="field">
          <span>Your name</span>
          <input value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="e.g. Ayesha Khan" autoFocus maxLength={60} />
        </label>
        <button className="btn btn--primary btn--wide" disabled={devName.trim().length < 2}>
          Continue
        </button>
      </form>
    );
  }

  const google = () => {
    // Called synchronously from the click so the Google window isn't blocked.
    setErr('');
    setBusy(true);
    sessionStorage.setItem('n360.signingIn', '1');
    signInWithGoogle()
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="signin">
      {prompt && <p className="signin__prompt">{prompt}</p>}
      <button className="btn btn--google btn--wide" disabled={busy} onClick={google}>
        <GoogleMark />
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {(err || authError) && <p className="form-error">{err || authError}</p>}
      <p className="signin__note">New here? Continuing with Google creates your host account.</p>
    </div>
  );
}
