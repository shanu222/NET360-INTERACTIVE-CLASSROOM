import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/auth.tsx';
import { api } from '../lib/api.ts';
import { SignIn } from '../components/SignIn.tsx';
import { CODE_ALPHABET } from '@net360/protocol';

const SUBJECTS = ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'Computer Science'];

export default function Home() {
  const nav = useNavigate();
  const { ready, user, headers, signOut } = useAuth();
  const [tab, setTab] = useState<'join' | 'teach'>('join');
  const [code, setCode] = useState('');
  const [subject, setSubject] = useState('Physics');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) nav(`/join?code=${code}`);
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api.startClass(await headers(), subject, topic.trim());
      nav(`/teach/${r.session.id}`, { state: { boardKey: r.boardKey } });
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="lobby">
      <div className="lobby__glow" />
      <motion.div className="lobby__card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
        <header className="lobby__head">
          <div className="brand">
            <span className="brand__mark" />
            NET360 <em>Classroom</em>
          </div>
          <p className="lobby__lede">The live board of your classroom, on every screen in the room.</p>
        </header>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'is-on' : ''} onClick={() => setTab('join')}>
            Join a class
          </button>
          <button role="tab" aria-selected={tab === 'teach'} className={tab === 'teach' ? 'is-on' : ''} onClick={() => setTab('teach')}>
            Start a class
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
                placeholder="K7P4QX"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
              />
            </label>
            <button className="btn btn--primary btn--wide" disabled={code.length !== 6}>
              Enter classroom
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={() => nav('/join?scan=1')}>
              Scan the board's QR code
            </button>
          </form>
        ) : !ready ? null : !user ? (
          <SignIn prompt="Teachers sign in with their NET360 account." />
        ) : (
          <form className="stack" onSubmit={start}>
            <label className="field">
              <span>Subject</span>
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Topic</span>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Heat and Thermodynamics" maxLength={120} />
            </label>
            <button className="btn btn--primary btn--wide" disabled={busy}>
              {busy ? 'Opening classroom…' : 'Start class'}
            </button>
            {err && <p className="form-error">{err}</p>}
            <p className="signin__note">
              Signed in as {user.name} ·{' '}
              <button type="button" className="link" onClick={signOut}>
                switch
              </button>
            </p>
          </form>
        )}
      </motion.div>
    </div>
  );
}
