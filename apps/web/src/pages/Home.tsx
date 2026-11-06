import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CODE_ALPHABET } from '@net360/protocol';
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
            NET360 <em>Classroom</em>
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
          <SignIn />
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
            <button className="btn btn--primary btn--wide" disabled={busy}>
              {busy ? 'Opening your classroom…' : 'Start class'}
            </button>
            {err && <p className="form-error">{err}</p>}
          </form>
        )}
      </motion.div>
    </Lobby>
  );
}
