import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { GoogleMark } from './Lobby.tsx';
import { Icon } from './Icons.tsx';

/**
 * Sign-in for hosts: a Google account, or an email account (sign in, create one,
 * or reset the password). A plain name field appears only on a local test server.
 */
export function SignIn({ prompt }: { prompt?: string }) {
  const { mode, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signInDev, authError } = useAuth();
  const [devName, setDevName] = useState(localStorage.getItem('n360.dev.name') ?? '');
  const [busy, setBusy] = useState<'' | 'google' | 'email'>('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  // null: the two choices · otherwise the email form in that state
  const [form, setForm] = useState<null | 'in' | 'up' | 'reset'>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

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
    setBusy('google');
    sessionStorage.setItem('n360.signingIn', '1');
    signInWithGoogle()
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(''));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setNote('');
    setBusy('email');
    try {
      if (form === 'up') await signUpWithEmail(name, email, password);
      else if (form === 'in') await signInWithEmail(email, password);
      else if (form === 'reset') {
        await resetPassword(email);
        setNote(`We sent a link to ${email.trim()} to choose a new password.`);
        setForm('in');
      }
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy('');
    }
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const ready =
    form === 'reset' ? validEmail : form === 'up' ? name.trim().length >= 2 && validEmail && password.length >= 8 : validEmail && password.length > 0;

  return (
    <div className="signin">
      {prompt && <p className="signin__prompt">{prompt}</p>}
      {form === null ? (
        <>
          <button className="btn btn--google btn--wide" disabled={Boolean(busy)} onClick={google}>
            <GoogleMark />
            {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
          </button>
          <button className="btn btn--ghost btn--wide" onClick={() => setForm('in')}>
            <Icon.mail /> Continue with email
          </button>
        </>
      ) : (
        <form className="stack signin__email" onSubmit={submit} noValidate>
          <div className="signin__head">
            <button type="button" className="signin__back" aria-label="Back" onClick={() => { setForm(null); setErr(''); setNote(''); }}>
              <Icon.left />
            </button>
            <strong>{form === 'up' ? 'Create your account' : form === 'reset' ? 'Reset your password' : 'Sign in with email'}</strong>
          </div>
          {form === 'up' && (
            <label className="field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown to participants" autoComplete="name" maxLength={60} autoFocus />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email" autoFocus={form !== 'up'} />
          </label>
          {form !== 'reset' && (
            <label className="field">
              <span>Password</span>
              <span className="signin__pw">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={form === 'up' ? 'At least 8 characters' : 'Your password'}
                  autoComplete={form === 'up' ? 'new-password' : 'current-password'}
                />
                <button type="button" className="signin__show" onClick={() => setShow((v) => !v)}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
          )}
          <button className="btn btn--primary btn--wide" disabled={!ready || Boolean(busy)}>
            {busy === 'email' ? 'Please wait…' : form === 'up' ? 'Create account' : form === 'reset' ? 'Send reset link' : 'Sign in'}
          </button>
          <div className="signin__links">
            {form === 'in' && (
              <>
                <button type="button" className="link" onClick={() => { setForm('up'); setErr(''); }}>
                  Create an account
                </button>
                <button type="button" className="link" onClick={() => { setForm('reset'); setErr(''); }}>
                  Forgot password?
                </button>
              </>
            )}
            {form !== 'in' && (
              <button type="button" className="link" onClick={() => { setForm('in'); setErr(''); }}>
                I already have an account
              </button>
            )}
          </div>
        </form>
      )}
      {note && <p className="signin__ok">{note}</p>}
      {(err || authError) && <p className="form-error">{err || authError}</p>}
    </div>
  );
}
