import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { GoogleMark } from './Lobby.tsx';

/** Sign-in: Google (NET360 accounts). A plain name field appears only on a local test server. */
export function SignIn({ prompt }: { prompt?: string }) {
  const { mode, signInWithGoogle, signInDev, authError } = useAuth();
  const [name, setName] = useState(localStorage.getItem('n360.dev.name') ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (mode === 'firebase') {
    return (
      <div className="signin">
        {prompt && <p className="signin__prompt">{prompt}</p>}
        <button
          className="btn btn--google btn--wide"
          disabled={busy}
          onClick={() => {
            // Called synchronously from the click so the Google window isn't blocked.
            setErr('');
            setBusy(true);
            signInWithGoogle()
              .catch((e) => setErr((e as Error).message))
              .finally(() => setBusy(false));
          }}
        >
          <GoogleMark />
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {(err || authError) && <p className="form-error">{err || authError}</p>}
        <p className="signin__note">Secure sign-in with your Google account</p>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length >= 2) signInDev(name);
  };
  return (
    <form className="signin" onSubmit={submit}>
      {prompt && <p className="signin__prompt">{prompt}</p>}
      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ayesha Khan" autoFocus maxLength={60} />
      </label>
      <button className="btn btn--primary btn--wide" disabled={name.trim().length < 2}>
        Continue
      </button>
    </form>
  );
}
