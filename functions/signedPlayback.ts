/**
 * KinoVault Reference Cloud Functions v2 (TypeScript)
 *
 * Production server-side verification & signed stream URL issuance sample.
 * Deploy inside a Firebase Cloud Functions workspace with `firebase-admin` and `firebase-functions/v2`.
 * Excluded from Vite client SPA bundling (`tsconfig.json`) so frontend lint stays decoupled.
 *
 * Security model:
 * - Client-side browser checks (`canWatch`, `localStorage`, `sessionStorage`) improve UX,
 *   but any raw MP4/HLS/YouTube URL loaded in browser DOM can be inspected via DevTools.
 * - For strict DRM/paywall protection, keep origin URLs private and call `issuePlaybackToken`
 *   after verifying an active Cinema Plus subscription OR a verified `users/{uid}/adUnlocks/{contentId}`
 *   record written by `verifyAdUnlockReward`.
 */

import crypto from 'node:crypto';

export interface SignedUrlConfig {
  cdnProvider: 'bunny' | 'cloudflare';
  bunnySecurityKey?: string;
  bunnyCdnBaseUrl?: string;
  cloudflareSigningKeyId?: string;
  cloudflareSigningJwkPem?: string;
  adRewardHmacSecret: string;
  tokenTtlSeconds?: number;
}

export interface CallableUserContext {
  uid: string;
  email?: string;
  role?: string;
}

export interface UnlockRecordDoc {
  contentId: string;
  contentType: 'movie' | 'episode';
  seriesId?: string;
  uid: string;
  unlockedAt: string;
  expiresAt: string | null;
  sessionOnly: boolean;
  adId: string;
  adKind: 'vast' | 'custom';
  format: 'video' | 'banner';
  method: 'ad_completed' | 'fallback_once';
}

export interface VerifyAdRewardInput {
  contentId: string;
  contentType: 'movie' | 'episode';
  seriesId?: string;
  adId: string;
  adKind: 'vast' | 'custom';
  format: 'video' | 'banner';
  /** HMAC-SHA256 signature issued by your VAST SSAI / ad-reward callback over `${uid}:${contentId}:${adId}:${nonce}` */
  rewardSignature: string;
  nonce: string;
  clickedAtMs?: number;
  completedAtMs: number;
  minRequiredSeconds?: number;
}

export interface FirestoreAdapter {
  getUserPlan(uid: string): Promise<{ plan: 'free' | 'premium'; planExpiresAt: string | null; role: string } | null>;
  getEffectiveAccessMode(
    contentId: string,
    seriesId?: string
  ): Promise<{ mode: 'free' | 'subscription' | 'ad_unlock' | 'sub_or_ad'; requiredPlanId: string | null; unlockHours: number }>;
  getUnlockRecord(uid: string, contentId: string): Promise<UnlockRecordDoc | null>;
  countRecentUnlocksLastHour(uid: string, nowMs: number): Promise<number>;
  getMaxUnlocksPerHour(): Promise<number>;
  saveUnlockRecord(uid: string, record: UnlockRecordDoc): Promise<void>;
  getPrivateVideoPath(contentId: string, seriesId?: string): Promise<string | null>;
}

/**
 * Generates an HMAC-SHA256 tokenized Bunny Stream CDN URL.
 * Docs: https://docs.bunny.net/docs/cdn-token-authentication
 */
export function signBunnyStreamUrl(params: {
  baseUrl: string;
  path: string;
  securityKey: string;
  expiresEpochSec: number;
  userIp?: string;
}): string {
  const { baseUrl, path, securityKey, expiresEpochSec, userIp = '' } = params;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const hashable = `${securityKey}${normalizedPath}${expiresEpochSec}${userIp}`;
  const rawHash = crypto.createHash('sha256').update(hashable).digest('base64');
  const token = rawHash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}${normalizedPath}?token=${token}&expires=${expiresEpochSec}`;
}

/**
 * Generates an RS256 signed JWT token compatible with Cloudflare Stream signed playback.
 * Docs: https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
 */
export function signCloudflareStreamToken(params: {
  videoUid: string;
  keyId: string;
  privateKeyPem: string;
  expiresEpochSec: number;
  uid: string;
}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: params.keyId, typ: 'JWT' })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: params.videoUid,
      kid: params.keyId,
      exp: params.expiresEpochSec,
      nbf: Math.floor(Date.now() / 1000) - 30,
      accessRules: [{ type: 'any', action: 'allow' }],
      viewerUid: params.uid,
    })
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(params.privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}

/**
 * Verifies ad completion conditions & hourly quota server-side before writing
 * `users/{uid}/adUnlocks/{contentId}` via Firebase Admin SDK.
 */
export async function verifyAdUnlockRewardHandler(
  user: CallableUserContext | null,
  input: VerifyAdRewardInput,
  config: SignedUrlConfig,
  store: FirestoreAdapter,
  nowMs = Date.now()
): Promise<{ ok: true; record: UnlockRecordDoc }> {
  if (!user?.uid) {
    throw new Error('UNAUTHENTICATED: Sign in required for server-verified unlock.');
  }

  // 1. Validate HMAC proof from VAST/reward callback (prevents forged client unlock requests)
  const expectedPayload = `${user.uid}:${input.contentId}:${input.adId}:${input.nonce}`;
  const expectedSig = crypto
    .createHmac('sha256', config.adRewardHmacSecret)
    .update(expectedPayload)
    .digest('hex');

  const sigBufA = Buffer.from(expectedSig, 'utf8');
  const sigBufB = Buffer.from(input.rewardSignature || '', 'utf8');
  if (sigBufA.length !== sigBufB.length || !crypto.timingSafeEqual(sigBufA, sigBufB)) {
    throw new Error('PERMISSION_DENIED: Invalid ad completion verification signature.');
  }

  // 2. For mandatory-click banners, verify measurable click timestamp + elapsed time
  if (input.format === 'banner') {
    const minSec = Math.max(5, input.minRequiredSeconds ?? 30);
    if (!input.clickedAtMs || input.completedAtMs - input.clickedAtMs < minSec * 1000) {
      throw new Error(
        `FAILED_PRECONDITION: Banner click and ${minSec}s viewing countdown must complete first.`
      );
    }
  }

  // 3. Enforce per-user hourly rate limit (default 20/hour)
  const [recentCount, maxPerHour, effective] = await Promise.all([
    store.countRecentUnlocksLastHour(user.uid, nowMs),
    store.getMaxUnlocksPerHour(),
    store.getEffectiveAccessMode(input.contentId, input.seriesId),
  ]);

  if (maxPerHour > 0 && recentCount >= maxPerHour) {
    throw new Error('RESOURCE_EXHAUSTED: Hourly ad unlock limit reached.');
  }

  if (effective.mode === 'subscription') {
    throw new Error('PERMISSION_DENIED: Title requires active Cinema Plus subscription.');
  }

  const sessionOnly = effective.unlockHours === 0;
  const expiresAt = sessionOnly
    ? null
    : new Date(nowMs + effective.unlockHours * 3600 * 1000).toISOString();

  const record: UnlockRecordDoc = {
    contentId: input.contentId,
    contentType: input.contentType,
    ...(input.seriesId ? { seriesId: input.seriesId } : {}),
    uid: user.uid,
    unlockedAt: new Date(nowMs).toISOString(),
    expiresAt,
    sessionOnly,
    adId: input.adId,
    adKind: input.adKind,
    format: input.format,
    method: 'ad_completed',
  };

  await store.saveUnlockRecord(user.uid, record);
  return { ok: true, record };
}

/**
 * Issues a short-lived signed Bunny Stream or Cloudflare Stream playback URL
 * strictly after server-side subscription or ad-unlock validation.
 */
export async function issuePlaybackTokenHandler(
  user: CallableUserContext | null,
  input: { contentId: string; seriesId?: string },
  config: SignedUrlConfig,
  store: FirestoreAdapter,
  nowMs = Date.now()
): Promise<{ playbackUrl: string; expiresAt: string; grantedBy: 'free' | 'subscriber' | 'ad_unlock' | 'admin' }> {
  const effective = await store.getEffectiveAccessMode(input.contentId, input.seriesId);
  let grantedBy: 'free' | 'subscriber' | 'ad_unlock' | 'admin' | null = null;

  if (user?.role === 'admin') {
    grantedBy = 'admin';
  } else if (effective.mode === 'free') {
    grantedBy = 'free';
  } else {
    if (!user?.uid) {
      throw new Error('PERMISSION_DENIED: Authentication required for gated stream.');
    }
    const profile = await store.getUserPlan(user.uid);
    const notExpired =
      !profile?.planExpiresAt || Date.parse(profile.planExpiresAt) > nowMs;
    if (profile?.plan === 'premium' && notExpired) {
      grantedBy = 'subscriber';
    } else if (effective.mode === 'sub_or_ad' || effective.mode === 'ad_unlock') {
      const unlock = await store.getUnlockRecord(user.uid, input.contentId);
      const unlockValid =
        unlock !== null &&
        (unlock.expiresAt === null || Date.parse(unlock.expiresAt) > nowMs);
      if (unlockValid) {
        grantedBy = 'ad_unlock';
      }
    }
  }

  if (!grantedBy) {
    throw new Error('PERMISSION_DENIED: Active subscription or completed ad unlock required.');
  }

  const privatePath = await store.getPrivateVideoPath(input.contentId, input.seriesId);
  if (!privatePath) {
    throw new Error('NOT_FOUND: Private video asset missing.');
  }

  const ttl = Math.max(60, config.tokenTtlSeconds ?? 900); // 15-minute signed window
  const expiresEpochSec = Math.floor(nowMs / 1000) + ttl;

  let playbackUrl = '';
  if (config.cdnProvider === 'bunny') {
    if (!config.bunnySecurityKey || !config.bunnyCdnBaseUrl) {
      throw new Error('INTERNAL: Bunny CDN signing credentials not configured.');
    }
    playbackUrl = signBunnyStreamUrl({
      baseUrl: config.bunnyCdnBaseUrl,
      path: privatePath,
      securityKey: config.bunnySecurityKey,
      expiresEpochSec,
    });
  } else {
    if (!config.cloudflareSigningKeyId || !config.cloudflareSigningJwkPem) {
      throw new Error('INTERNAL: Cloudflare Stream signing credentials not configured.');
    }
    const jwt = signCloudflareStreamToken({
      videoUid: privatePath.replace(/^\/+/, ''),
      keyId: config.cloudflareSigningKeyId,
      privateKeyPem: config.cloudflareSigningJwkPem,
      expiresEpochSec,
      uid: user?.uid || 'anon',
    });
    playbackUrl = `https://videodelivery.net/${jwt}/manifest/video.m3u8`;
  }

  return {
    playbackUrl,
    expiresAt: new Date(expiresEpochSec * 1000).toISOString(),
    grantedBy,
  };
}
