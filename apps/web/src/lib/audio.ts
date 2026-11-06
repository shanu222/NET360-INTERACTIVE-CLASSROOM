import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AudioState, ClientToServer, ServerToClient } from '@net360/protocol';
import type { Room } from 'livekit-client';

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
}

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/**
 * Joins the class audio room (LiveKit). The teacher is always heard; a student may
 * speak only while the server allows it — permissions are enforced by LiveKit.
 */
export function useClassAudio(
  socket: Socket<ServerToClient, ClientToServer> | null,
  audio: AudioState | null,
  ready: boolean,
): ClassAudio {
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
      room = new lk.Room({ adaptiveStream: false, dynacast: true, audioCaptureDefaults: MIC });
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
      room
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== Track.Kind.Audio) return;
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
        })
        .on(RoomEvent.TrackMuted, (pub, p) => {
          // The teacher muted me from the server.
          if (p === room!.localParticipant && pub.source === Track.Source.Microphone) setMicOn(false);
          refreshTeacher();
        })
        .on(RoomEvent.TrackUnmuted, refreshTeacher)
        .on(RoomEvent.TrackPublished, refreshTeacher)
        .on(RoomEvent.TrackUnpublished, refreshTeacher)
        .on(RoomEvent.ParticipantConnected, refreshTeacher)
        .on(RoomEvent.ParticipantDisconnected, refreshTeacher)
        // The teacher took away the right to speak: the mic is off.
        .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
          const perms = room!.localParticipant.permissions;
          if (p === room!.localParticipant && perms && perms.canPublish === false) setMicOn(false);
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
      setStatus('off');
    };
  }, [socket, ready, available]);

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

  return { status, needsTap, startSound, micOn, micBusy, setMic, micError, heard, setHeard, speaking, teacherLive };
}
