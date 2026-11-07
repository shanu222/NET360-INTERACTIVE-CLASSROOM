import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CLASS_SIZES, CODE_ALPHABET } from '@net360/protocol';
import { useAuth } from '../lib/auth.tsx';
import { api } from '../lib/api.ts';
import { SignIn } from '../components/SignIn.tsx';
import { Lobby } from '../components/Lobby.tsx';
import { Icon } from '../components/Icons.tsx';

const SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'Computer Science'];

export default function Home() {
  const nav = useNavigate();
  const { ready, user, headers, signOut } = useAuth();
  const [tab, setTab] = useState<'join' | 'teach'>('join');
  const [code, setCode] = useState('');
  const [subject, setSubject] = useState('Physics');
  const [topic, setTopic] = useState('');
  const [size, setSize] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem('n360.size'));
      return (CLASS_SIZES as readonly number[]).includes(n) ? n : CLASS_SIZES[0];
    } catch {
      return CLASS_SIZES[0];
    }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Only the Meeto360 admin account can start and teach classes.
  const [canTeach, setCanTeach] = useState<boolean | null>(null);
  useEffect(() => {
    if (tab !== 'teach' || !user) return;
    let off = false;
    setCanTeach(null);
    headers()
      .then((h) => api.me(h))
      .then((r) => !off && setCanTeach(r.canTeach))
      .catch(() => !off && setCanTeach(true)); // the server still checks when the class starts
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user?.uid]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) nav(`/join?code=${code}`);
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      try {
        localStorage.setItem('n360.size', String(size));
      } catch {
        /* private mode */
      }
      const r = await api.startClass(await headers(), subject, topic.trim(), size);
      nav(`/teach/${r.session.id}`, { state: { boardKey: r.boardKey, padKey: r.padKey } });
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  };

  return (
    <Lobby>
      <motion.div className="card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
        <div className="brand">
          <span className="brand__mark" />
          <span>
            Meeto<em>360</em>
          </span>
        </div>
        <h1 className="card__title">{tab === 'join' ? 'Welcome to class' : 'Open your classroom'}</h1>
        <p className="card__lede">
          {tab === 'join'
            ? 'Enter the code on the classroom board, or scan its QR code.'
            : 'Start a live lesson. Everything you write appears on every screen in the room.'}
        </p>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'is-on' : ''} onClick={() => setTab('join')}>
            I'm a student
          </button>
          <button role="tab" aria-selected={tab === 'teach'} className={tab === 'teach' ? 'is-on' : ''} onClick={() => setTab('teach')}>
            I'm a teacher
          </button>
        </div>

        {tab === 'join' ? (
          <form className="stack" onSubmit={join}>
            <label className="field">
              <span>Class code</span>
              <input
                className="input--code"
                value={code}
                onChange={(e) => setCode([...e.target.value.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6))}
                placeholder="ABC123"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                aria-label="Class code"
              />
            </label>
            <button className="btn btn--primary btn--wide" disabled={code.length !== 6}>
              Join class
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={() => nav('/join?scan=1')}>
              <Icon.scan /> Scan QR code
            </button>
          </form>
        ) : !ready ? (
          <div className="card__loading" />
        ) : !user ? (
          <SignIn prompt="Teachers sign in with the Meeto360 admin Google account." />
        ) : canTeach === null ? (
          <div className="card__loading" />
        ) : !canTeach ? (
          <div className="stack">
            <div className="notice">
              <strong>This account can't start classes</strong>
              <span>
                You're signed in as {user.email ?? user.name}. Only the Meeto360 teacher account can teach. To join a lesson, switch to
                “I'm a student” and enter your class code.
              </span>
            </div>
            <button type="button" className="btn btn--primary btn--wide" onClick={() => setTab('join')}>
              Join as a student
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={signOut}>
              Use a different account
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={start}>
            <div className="who">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="who__text">
                <strong>{user.name}</strong>
                <span>Teacher</span>
              </span>
              <button type="button" className="link" onClick={signOut}>
                Switch account
              </button>
            </div>
            <label className="field">
              <span>Subject</span>
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Today's topic</span>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Heat and Thermodynamics" maxLength={120} />
            </label>
            <fieldset className="field sizes">
              <legend>Students expected (up to)</legend>
              <div className="sizes__row" role="radiogroup" aria-label="Students expected">
                {CLASS_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={size === n}
                    className={size === n ? 'is-on' : ''}
                    onClick={() => setSize(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="sizes__hint">
                {size <= 40 ? 'A classroom with desks for 40.' : size <= 60 ? 'A larger classroom with 64 desks.' : size <= 150 ? 'A lecture room with seats for 150.' : size <= 300 ? 'A lecture hall with seats for 300.' : 'An auditorium with seats for 500.'}
              </span>
            </fieldset>
            <button className="btn btn--primary btn--wide" disabled={busy}>
              {busy ? 'Opening your classroom…' : 'Start class'}
            </button>
            {err && <p className="form-error">{/not set up as a teacher/i.test(err) ? "This account can't start classes." : err}</p>}
          </form>
        )}
      </motion.div>
    </Lobby>
  );
}
