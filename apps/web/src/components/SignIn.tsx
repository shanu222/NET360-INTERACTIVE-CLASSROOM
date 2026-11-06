import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth.tsx';

/** Sign-in card: Google via Firebase in production, a name in local dev mode. */
export function SignIn({ prompt = 'Sign in to continue' }: { prompt?: string }) {
  const { mode, signInWithGoogle, signInDev } = useAuth();
  const [name, setName] = useState(localStorage.getItem('n360.dev.name') ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (mode === 'firebase') {
    return (
      <div className="signin">
        <p className="signin__prompt">{prompt}</p>
        <button
          className="btn btn--primary btn--wide"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              await signInWithGoogle();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Continue with Google
        </button>
        {err && <p className="form-error">{err}</p>}
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length >= 2) signInDev(name);
  };
  return (
    <form className="signin" onSubmit={submit}>
      <p className="signin__prompt">{prompt}</p>
      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ayesha Khan" autoFocus maxLength={60} />
      </label>
      <button className="btn btn--primary btn--wide" disabled={name.trim().length < 2}>
        Continue
      </button>
      <p className="signin__note">Development mode — connect Firebase to use NET360 accounts.</p>
    </form>
  );
}
