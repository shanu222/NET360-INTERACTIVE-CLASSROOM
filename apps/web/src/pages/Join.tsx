import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { SessionInfo } from '@net360/protocol';
import { CODE_ALPHABET } from '@net360/protocol';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { Icon } from '../components/Icons.tsx';
import { Lobby } from '../components/Lobby.tsx';

/** Pull a class code from a scanned join URL or a typed code. */
function codeFrom(text: string): string | null {
  try {
    const c = new URL(text).searchParams.get('code');
    if (c) return c.toUpperCase();
  } catch {
    /* not a URL */
  }
  const t = text.trim().toUpperCase();
  return t.length === 6 && [...t].every((c) => CODE_ALPHABET.includes(c)) ? t : null;
}

export default function Join() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { ready, user } = useAuth();
  const [code, setCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [scanning, setScanning] = useState(params.get('scan') === '1' && !params.get('code'));
  const [found, setFound] = useState<{ session: SessionInfo; present: number } | null>(null);
  const [err, setErr] = useState('');
  const [entering, setEntering] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  // Look the class up as soon as there is a full code.
  useEffect(() => {
    if (code.length !== 6) return setFound(null);
    setErr('');
    api.lookup(code).then(setFound).catch(() => setErr('No live class has this code. Check the board and try again.'));
  }, [code]);

  // QR scanning with the device camera.
  useEffect(() => {
    if (!scanning || !video.current) return;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let stopped = false;
    import('qr-scanner').then(({ default: QrScanner }) => {
      if (stopped || !video.current) return;
      scanner = new QrScanner(
        video.current,
        (r: { data: string }) => {
          const c = codeFrom(r.data);
          if (c) {
            setCode(c);
            setScanning(false);
          }
        },
        { preferredCamera: 'environment', highlightScanRegion: false, returnDetailedScanResult: true },
      );
      scanner.start().catch(() => {
        setErr('The camera is not available. Please type the code shown on the board.');
        setScanning(false);
      });
    });
    return () => {
      stopped = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [scanning]);

  // Signed in on this card? Go straight in — no extra tap.
  const signedOutHere = useRef(false);
  useEffect(() => {
    if (ready && !user) signedOutHere.current = true;
    if (user && found && signedOutHere.current && !entering) {
      signedOutHere.current = false;
      enter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, found]);

  const enter = () => {
    if (!found) return;
    setEntering(true);
    setTimeout(() => nav(`/class/${found.session.id}`, { state: { entering: true } }), 520);
  };

  const n = found?.present ?? 0;
  return (
    <Lobby>
      <AnimatePresence mode="wait">
        {!entering && (
          <motion.div
            key="card"
            className="card"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.05, filter: 'blur(6px)' }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="brand">
              <span className="brand__mark" />
              <span>
                NET360 <em>Classroom</em>
              </span>
            </div>

            {scanning ? (
              <div className="scan">
                <h1 className="card__title">Scan the board</h1>
                <div className="scan__view">
                  <video ref={video} className="scan__video" muted playsInline />
                  <div className="scan__frame" />
                </div>
                <p className="card__lede">Point your camera at the QR code on the classroom board.</p>
                <button className="btn btn--ghost btn--wide" onClick={() => setScanning(false)}>
                  Type the code instead
                </button>
              </div>
            ) : found ? (
              <div className="classcard">
                <span className="pill pill--live-light">
                  <span className="live-dot" /> Live now
                </span>
                <h1 className="classcard__subject">{found.session.subject}</h1>
                {found.session.topic && <p className="classcard__topic">{found.session.topic}</p>}
                <div className="classcard__teacher">
                  <span className="avatar avatar--sm">{found.session.teacherName.slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{found.session.teacherName}</strong>
                    <small>{n === 0 ? 'Be the first to join' : `${n} ${n === 1 ? 'student is' : 'students are'} in class`}</small>
                  </span>
                </div>
                {!ready ? (
                  <div className="card__loading" />
                ) : user ? (
                  <>
                    <button className="btn btn--primary btn--wide" onClick={enter} autoFocus>
                      Enter classroom
                    </button>
                    <p className="signin__note">Joining as {user.name}</p>
                  </>
                ) : (
                  <SignIn prompt="Sign in to take your seat." />
                )}
                <button className="link" onClick={() => setCode('')}>
                  Not this class?
                </button>
              </div>
            ) : (
              <div className="stack">
                <h1 className="card__title">Join your class</h1>
                <p className="card__lede">Enter the six-character code shown on the classroom board.</p>
                <label className="field">
                  <span>Class code</span>
                  <input
                    className="input--code"
                    value={code}
                    onChange={(e) => setCode([...e.target.value.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6))}
                    placeholder="ABC123"
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
                    aria-label="Class code"
                  />
                </label>
                {err && <p className="form-error">{err}</p>}
                <button className="btn btn--ghost btn--wide" onClick={() => setScanning(true)}>
                  <Icon.scan /> Scan QR code
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Lobby>
  );
}
