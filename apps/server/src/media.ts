import { AccessToken } from 'livekit-server-sdk';
import { config, mediaEnabled } from './config.ts';

/**
 * LiveKit access token for a classroom's media room (Phase 4).
 * Teachers may publish camera and mic; students and the board only subscribe
 * until the teacher invites a student (permission is raised server-side then).
 */
export async function mediaToken(opts: {
  sessionId: string;
  identity: string;
  name: string;
  canPublish: boolean;
}): Promise<{ url: string; token: string } | null> {
  if (!mediaEnabled) return null;
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: '6h',
  });
  at.addGrant({
    room: `class-${opts.sessionId}`,
    roomJoin: true,
    canSubscribe: true,
    canPublish: opts.canPublish,
    canPublishData: false,
  });
  return { url: config.livekit.url, token: await at.toJwt() };
}
