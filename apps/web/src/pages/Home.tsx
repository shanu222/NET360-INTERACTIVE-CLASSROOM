import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CLASS_SIZES, CODE_ALPHABET, type SessionKind } from '@net360/protocol';
import { useAuth } from '../lib/auth.tsx';
import { api } from '../lib/api.ts';
import { SignIn } from '../components/SignIn.tsx';
import { Lobby } from '../components/Lobby.tsx';
import { Icon } from '../components/Icons.tsx';

const SUGGESTIONS: Record<SessionKind, string[]> = {
  meeting: ['Weekly team meeting', 'Project review', 'One-to-one', 'Workshop'],
  class: ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'English', 'Computer Science'],
};

const remembered = <T,>(key: string, ok: (v: string) => T | null, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return (v !== null ? ok(v) : null) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
};

/** The front door: join with a code, or sign in and create a meeting or class. */
export default function Home() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { ready, user, headers, signOut } = useAuth();
  const [tab, setTab] = useState<'join' | 'create'>(() => (params.has('create') || sessionStorage.getItem('n360.signingIn') ? 'create' : 'join'));
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<SessionKind>(() => remembered('n360.kind', (v) => (v === 'class' || v === 'meeting' ? v : null), 'meeting'));
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [size, setSize] = useState<number>(() =>
    remembered('n360.size', (v) => ((CLASS_SIZES as readonly number[]).includes(Number(v)) ? Number(v) : null), CLASS_SIZES[0]),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const thing = kind === 'meeting' ? 'meeting' : 'class';

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length === 6) nav(`/join?code=${code}`);
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    remember('n360.size', String(size));
    remember('n360.kind', kind);
    try {
      const name = title.trim() || (kind === 'meeting' ? `${user?.name ?? 'My'}’s meeting` : 'Class');
      const r = await api.startClass(await headers(), name, topic.trim(), size, kind);
      nav(`/host/${r.session.id}`, { state: { boardKey: r.boardKey, padKey: r.padKey } });
    } catch (ex) {
      const m = (ex as Error).message;
      setErr(/not allowed|not set up/i.test(m) ? 'This account can’t host here. Sign in with another account.' : m);
      setBusy(false);
    }
  };

  return (
    <Lobby>
      <motion.div className="card home" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
        <div className="brand">
          <span className="brand__mark" />
          <span>
            Meeto<em>360</em>
          </span>
        </div>
        <h1 className="card__title">{tab === 'join' ? 'Join a meeting or class' : 'Create a meeting or class'}</h1>
        <p className="card__lede">
          {tab === 'join'
            ? 'Enter the code the host shared with you. No account needed.'
            : 'Host live with voice, a shared whiteboard, slides and screen sharing. Everyone joins with a code.'}
        </p>

        <div className="tabs tabs--icons" role="tablist">
          <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'is-on' : ''} onClick={() => setTab('join')}>
            <Icon.enter /> Join
          </button>
          <button role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'is-on' : ''} onClick={() => setTab('create')}>
            <Icon.video /> Create
          </button>
        </div>

        {tab === 'join' ? (
          <form className="stack" onSubmit={join}>
            <label className="field">
              <span>Meeting or class code</span>
              <input
                className="input--code"
                value={code}
                onChange={(e) => setCode([...e.target.value.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6))}
                placeholder="ABC123"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                aria-label="Meeting or class code"
              />
            </label>
            <button className="btn btn--primary btn--wide" disabled={code.length !== 6}>
              Join
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={() => nav('/join?scan=1')}>
              <Icon.scan /> Scan QR code
            </button>
          </form>
        ) : !ready ? (
          <div className="card__loading" />
        ) : !user ? (
          <SignIn prompt="Sign in to host. Participants won’t need an account." />
        ) : (
          <form className="stack" onSubmit={start}>
            <div className="who">
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="who__text">
                <strong>{user.name}</strong>
                <span>{user.email ?? 'Host'}</span>
              </span>
              <button type="button" className="link" onClick={signOut}>
                Sign out
              </button>
            </div>
            <div className="kindpick" role="radiogroup" aria-label="What are you hosting?">
              {(['meeting', 'class'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>
                  {k === 'meeting' ? <Icon.users /> : <Icon.board />}
                  <span>
                    <strong>{k === 'meeting' ? 'Meeting' : 'Class'}</strong>
                    <small>{k === 'meeting' ? 'Talk, share and plan' : 'Teach with board and slides'}</small>
                  </span>
                </button>
              ))}
            </div>
            <label className="field">
              <span>{kind === 'meeting' ? 'Meeting name' : 'Class or subject'}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'meeting' ? `${user.name}’s meeting` : 'e.g. Physics'}
                maxLength={80}
                list={`suggest-${kind}`}
              />
              <datalist id={`suggest-${kind}`}>
                {SUGGESTIONS[kind].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>{kind === 'meeting' ? 'Agenda (optional)' : 'Today’s topic (optional)'}</span>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={kind === 'meeting' ? 'e.g. Plans for next week' : 'e.g. Heat and Thermodynamics'} maxLength={120} />
            </label>
            <fieldset className="field sizes">
              <legend>Participants expected (up to)</legend>
              <div className="sizes__row" role="radiogroup" aria-label="Participants expected">
                {CLASS_SIZES.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={size === n} className={size === n ? 'is-on' : ''} onClick={() => setSize(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <span className="sizes__hint">
                {size <= 40 ? 'A room for up to 40.' : size <= 60 ? 'A larger room for up to 64.' : size <= 150 ? 'A lecture room for 150.' : size <= 300 ? 'A hall for 300.' : 'An auditorium for 500.'}
              </span>
            </fieldset>
            <button className="btn btn--primary btn--wide" disabled={busy}>
              {busy ? `Opening your ${thing}…` : `Start ${thing}`}
            </button>
            {err && <p className="form-error">{err}</p>}
          </form>
        )}
      </motion.div>
    </Lobby>
  );
}
