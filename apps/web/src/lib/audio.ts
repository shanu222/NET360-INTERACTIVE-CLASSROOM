import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AudioState, ClientToServer, ServerToClient } from '@net360/protocol';
import type { LocalAudioTrack, RemoteVideoTrack, Room } from 'livekit-client';
import { canDenoise } from './denoise.ts';

export type AudioStatus = 'off' | 'connecting' | 'on' | 'error';

export interface ClassAudio {
  status: AudioStatus;
  /** The browser blocked sound until the person taps once. */
  needsTap: boolean;
  startSound: () => void;
  /** My microphone is live. */
  micOn: boolean;
  /** Switching my microphone on or off is in progress. */
  micBusy: boolean;
  setMic: (on: boolean) => Promise<void>;
  /** Couldn't use the microphone (permission denied, no device…). */
  micError: string | null;
  /** I hear the class (students can silence it on their own device). */
  heard: boolean;
  setHeard: (on: boolean) => void;
  /** Who is speaking right now (uids). */
  speaking: Set<string>;
  /** The teacher's microphone is live (for students). */
  teacherLive: boolean;
  /** Someone else's shared screen, if any. */
  screen: { track: RemoteVideoTrack; uid: string; name: string } | null;
  /** I'm sharing my screen. */
  sharing: boolean;
  shareBusy: boolean;
  shareScreen: (on: boolean) => Promise<void>;
  /** This device can share its screen (phones can't). */
  canShare: boolean;
}

/** LiveKit's numbers for track sources in permissions. */
const SRC_MIC = 2;
const SRC_SCREEN = 3;
const allows = (perms: { canPublish: boolean; canPublishSources: number[] } | undefined, src: number) =>
  Boolean(perms?.canPublish) && (!perms!.canPublishSources.length || perms!.canPublishSources.includes(src));

/**
 * Microphone capture tuned for speech: the browser removes echo and steady noise and
 * evens out the level; one channel at 48 kHz. (Chrome's voice isolation is used where
 * it exists.) Our own noise filter then cleans up what's left — see denoise.ts.
 */
const MIC = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  voiceIsolation: true,
} as MediaTrackConstraints;

/**
 * Joins the class audio room (LiveKit). The teacher is always heard; a student may
 * speak only while the server allows it — permissions are enforced by LiveKit.
 */
export function useClassAudio(
  socket: Socket<ServerToClient, ClientToServer> | null,
  audio: AudioState | null,
  ready: boolean,
  opts: { watchOnly?: boolean } = {},
): ClassAudio {
  const watchOnly = Boolean(opts.watchOnly);
  const [screen, setScreen] = useState<ClassAudio['screen']>(null);
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [status, setStatus] = useState<AudioStatus>('off');
  const [needsTap, setNeedsTap] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [heard, setHeardState] = useState(() => {
    try {
      return localStorage.getItem('n360.heard') !== '0';
    } catch {
      return true;
    }
  });
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [teacherLive, setTeacherLive] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const els = useRef(new Set<HTMLMediaElement>());
  const heardRef = useRef(heard);
  heardRef.current = heard;

  const available = Boolean(audio?.available);

  useEffect(() => {
    if (!socket || !ready || !available) return;
    let cancelled = false;
    let room: Room | null = null;
    setStatus('connecting');

    void (async () => {
      const lk = await import('livekit-client');
      const join = () =>
        new Promise<{ url: string; token: string } | { error: string }>((res) => socket.emit('mediaJoin', res));
      const r = await join();
      if (cancelled) return;
      if ('error' in r) {
        setStatus('error');
        return;
      }
      room = new lk.Room({
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: MIC,
        // Clear speech: 48 kbps Opus, silence not sent, and each packet carried twice
        // (RED) so a lost packet on a weak connection doesn't become a gap or crackle.
        publishDefaults: { audioPreset: lk.AudioPresets.music, dtx: true, red: true, forceStereo: false },
      });
      roomRef.current = room;
      const { RoomEvent, Track } = lk;

      const refreshTeacher = () => {
        let live = false;
        for (const p of room!.remoteParticipants.values()) {
          if (p.attributes?.role !== 'teacher') continue;
          for (const pub of p.audioTrackPublications.values()) if (!pub.isMuted && pub.track) live = true;
        }
        setTeacherLive(live);
      };
      /** The shared screen to show: any participant's live screen share. */
      const refreshScreen = () => {
        let found: ClassAudio['screen'] = null;
        for (const p of room!.remoteParticipants.values()) {
          for (const pub of p.videoTrackPublications.values()) {
            if (pub.source === Track.Source.ScreenShare && pub.track && !pub.isMuted) {
              found = { track: pub.track as RemoteVideoTrack, uid: p.identity, name: p.name || 'Someone' };
            }
          }
        }
        setScreen((cur) => (cur?.track === found?.track ? cur : found));
      };
      const stopMyShare = () => {
        const lp = room!.localParticipant;
        if (lp.isScreenShareEnabled) void lp.setScreenShareEnabled(false).catch(() => undefined);
        setSharing(false);
      };
      room
        .on(RoomEvent.TrackSubscribed, (track, pub, from) => {
          if (track.kind === Track.Kind.Video) return refreshScreen();
          // The classroom screen shows shared screens only; sound comes from the room itself.
          if (track.kind !== Track.Kind.Audio || watchOnly) return;
          // Never play anyone their own voice — e.g. the host who also opened the meeting as
          // a participant on another device or tab. (That would echo and howl.)
          if (samePerson(from.identity, room!.localParticipant.identity)) {
            pub.setSubscribed(false);
            return;
          }
          const el = track.attach();
          el.muted = !heardRef.current;
          el.style.display = 'none';
          document.body.appendChild(el);
          els.current.add(el);
          refreshTeacher();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          for (const el of track.detach()) {
            els.current.delete(el);
            el.remove();
          }
          refreshTeacher();
          refreshScreen();
        })
        .on(RoomEvent.TrackMuted, (pub, p) => {
          // The teacher switched my microphone or screen off from the server.
          if (p === room!.localParticipant && pub.source === Track.Source.Microphone) setMicOn(false);
          if (p === room!.localParticipant && pub.source === Track.Source.ScreenShare) stopMyShare();
          refreshTeacher();
          refreshScreen();
        })
        .on(RoomEvent.TrackUnmuted, () => {
          refreshTeacher();
          refreshScreen();
        })
        .on(RoomEvent.TrackPublished, refreshTeacher)
        .on(RoomEvent.TrackUnpublished, () => {
          refreshTeacher();
          refreshScreen();
        })
        .on(RoomEvent.ParticipantConnected, refreshTeacher)
        .on(RoomEvent.ParticipantDisconnected, () => {
          refreshTeacher();
          refreshScreen();
        })
        .on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.source === Track.Source.ScreenShare) setSharing(true);
        })
        .on(RoomEvent.LocalTrackUnpublished, (pub) => {
          // Also fires when the browser's own "Stop sharing" button is used.
          if (pub.source === Track.Source.ScreenShare) setSharing(false);
        })
        // The teacher took away the right to speak or present: switch those off.
        .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
          if (p !== room!.localParticipant) return;
          const perms = room!.localParticipant.permissions;
          if (!perms) return;
          if (!allows(perms, SRC_MIC)) setMicOn(false);
          if (!allows(perms, SRC_SCREEN)) stopMyShare();
        })
        .on(RoomEvent.ActiveSpeakersChanged, (ps) => setSpeaking(new Set(ps.map((p) => p.identity))))
        .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!room!.canPlaybackAudio))
        .on(RoomEvent.Reconnecting, () => setStatus('connecting'))
        .on(RoomEvent.Reconnected, () => setStatus('on'))
        .on(RoomEvent.Disconnected, () => {
          if (!cancelled) setStatus('error');
          setMicOn(false);
        });

      try {
        await room.connect(r.url, r.token, { autoSubscribe: true });
        if (cancelled) return room.disconnect();
        setStatus('on');
        setNeedsTap(!room.canPlaybackAudio);
        refreshTeacher();
        refreshScreen();
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      void room?.disconnect();
      roomRef.current = null;
      for (const el of els.current) el.remove();
      els.current.clear();
      setMicOn(false);
      setSharing(false);
      setScreen(null);
      setStatus('off');
    };
  }, [socket, ready, available, watchOnly]);

  const shareScreen = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    setShareBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(
        on,
        { audio: false, selfBrowserSurface: 'exclude', contentHint: 'detail', resolution: { width: 1920, height: 1080, frameRate: 15 } },
        { videoCodec: 'vp8' },
      );
      setSharing(room.localParticipant.isScreenShareEnabled);
    } catch (e) {
      setSharing(false);
      const msg = String((e as Error)?.message ?? e);
      // Closing the browser's "choose what to share" window is not an error.
      if (!/denied|notallowed|cancel|abort/i.test(msg)) setMicError('Couldn’t share your screen. Please try again.');
    } finally {
      setShareBusy(false);
    }
  }, []);
  const canShare = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia) && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  const setMic = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    const lk = await import('livekit-client');
    const lp = room.localParticipant;
    setMicError(null);
    setMicBusy(true);
    try {
      if (on) {
        // Clear a microphone the server switched off earlier, then publish afresh.
        const old = lp.getTrackPublication(lk.Track.Source.Microphone);
        if (old?.track && (old.isMuted || !lp.permissions?.canPublish)) await lp.unpublishTrack(old.track, true).catch(() => undefined);
        await Promise.race([
          lp.setMicrophoneEnabled(true, MIC),
          new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 20_000)),
        ]);
        setMicOn(true);
        void cleanMic(room, lk);
        if (!room.canPlaybackAudio) void room.startAudio().then(() => setNeedsTap(false));
      } else {
        await lp.setMicrophoneEnabled(false);
        setMicOn(false);
      }
    } catch (e) {
      setMicOn(false);
      void lp.setMicrophoneEnabled(false).catch(() => undefined);
      const msg = String((e as Error)?.message ?? e);
      setMicError(
        /permission|denied|notallowed/i.test(msg)
          ? 'Allow microphone access in your browser to speak.'
          : /not found|no device|requested device/i.test(msg)
            ? 'No microphone found. Plug one in and try again.'
            : 'Couldn’t turn on the microphone. Please try again.',
      );
    } finally {
      setMicBusy(false);
    }
  }, []);

  const setHeard = useCallback((on: boolean) => {
    setHeardState(on);
    try {
      localStorage.setItem('n360.heard', on ? '1' : '0');
    } catch {
      /* fine */
    }
    for (const el of els.current) el.muted = !on;
    if (on) void roomRef.current?.startAudio().then(() => setNeedsTap(false));
  }, []);

  const startSound = useCallback(() => {
    void roomRef.current?.startAudio().then(() => setNeedsTap(false));
  }, []);

  return { screen, sharing, shareBusy, shareScreen, canShare, status, needsTap, startSound, micOn, micBusy, setMic, micError, heard, setHeard, speaking, teacherLive };
}

/** Run the microphone through the noise filter (once per published track). */
async function cleanMic(room: import('livekit-client').Room, lk: typeof import('livekit-client')) {
  if (!canDenoise()) return;
  const track = room.localParticipant.getTrackPublication(lk.Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
  if (!track || track.getProcessor()) return;
  try {
    const { NoiseFilter, denoiseContext } = await import('./denoise.ts');
    track.setAudioContext(denoiseContext());
    await track.setProcessor(new NoiseFilter());
  } catch (e) {
    // The browser's own noise reduction still applies.
    console.warn('[audio] noise filter unavailable:', (e as Error)?.message ?? e);
  }
}

/** One person on two screens: the host's account also joins as "<uid>#student". */
export function samePerson(a: string, b: string) {
  const base = (id: string) => id.replace(/#student$/, '');
  return Boolean(a && b) && base(a) === base(b);
}
