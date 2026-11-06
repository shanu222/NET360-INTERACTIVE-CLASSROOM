import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { SessionInfo } from '@net360/protocol';
import { CODE_ALPHABET } from '@net360/protocol';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { Icon } from '../components/Icons.tsx';

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
    api.lookup(code).then(setFound).catch((e) => setErr(e.message));
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
        setErr('Camera unavailable — type the code shown on the board instead.');
        setScanning(false);
      });
    });
    return () => {
      stopped = true;
      scanner?.stop();
      scanner?.destroy();
    };
  }, [scanning]);

  const enter = () => {
    if (!found) return;
    setEntering(true);
    setTimeout(() => nav(`/class/${found.session.id}`, { state: { entering: true } }), 520);
  };

  return (
    <div className="lobby">
      <div className="lobby__glow" />
      <AnimatePresence mode="wait">
        {!entering && (
          <motion.div
            key="card"
            className="lobby__card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.06, filter: 'blur(6px)' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="brand brand--small">
              <span className="brand__mark" />
              NET360 <em>Classroom</em>
            </div>

            {scanning ? (
              <div className="scan">
                <video ref={video} className="scan__video" muted playsInline />
                <div className="scan__frame" />
                <p className="scan__hint">Point your camera at the QR code on the classroom board</p>
                <button className="btn btn--ghost btn--wide" onClick={() => setScanning(false)}>
                  Type the code instead
                </button>
              </div>
            ) : found ? (
              <div className="classcard">
                <p className="classcard__eyebrow">
                  <span className="live-dot" /> Live now
                </p>
                <h1 className="classcard__subject">{found.session.subject}</h1>
                {found.session.topic && <p className="classcard__topic">{found.session.topic}</p>}
                <p className="classcard__meta">
                  with {found.session.teacherName} · {found.present} {found.present === 1 ? 'student' : 'students'} inside
                </p>
                {!ready ? null : user ? (
                  <button className="btn btn--primary btn--wide" onClick={enter} autoFocus>
                    Enter classroom
                  </button>
                ) : (
                  <SignIn prompt="Sign in to enter the classroom." />
                )}
                <button className="link" onClick={() => setCode('')}>
                  Not this class?
                </button>
              </div>
            ) : (
              <div className="stack">
                <label className="field">
                  <span>Class code on the board</span>
                  <input
                    className="input--code"
                    value={code}
                    onChange={(e) => setCode([...e.target.value.toUpperCase()].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6))}
                    placeholder="K7P4QX"
                    autoFocus
                    autoComplete="off"
                    autoCapitalize="characters"
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
    </div>
  );
}
