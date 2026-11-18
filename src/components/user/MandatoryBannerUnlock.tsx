import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, Lock, MousePointerClick, Play, X } from 'lucide-react';
import type {
  AdGlobalSettings,
  AdTargetContentType,
  CustomAdItem,
} from '../../types/streaming';
import { detectCurrentDevice } from '../../utils/adEngine';
import { trackAdEvent } from '../../lib/adsFirebase';

interface MandatoryBannerUnlockProps {
  ad: CustomAdItem;
  adSettings: AdGlobalSettings;
  userId?: string;
  contentId: string;
  contentType: AdTargetContentType;
  unlockStepLabel?: string;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Mandatory-Click Banner Ad Unlock Stage.
 * Rules enforced:
 * - Banner remains visible inside player area until viewer explicitly clicks it (never auto-dismisses).
 * - Loading alone NEVER unlocks; clicking alone NEVER unlocks immediately.
 * - Both mandatory click AND configured countdown duration must be satisfied.
 * - Closing early aborts without unlocking.
 * - Honestly notes client-side measurable click + elapsed time verification.
 */
export const MandatoryBannerUnlock: React.FC<MandatoryBannerUnlockProps> = ({
  ad,
  adSettings,
  userId,
  contentId,
  contentType,
  unlockStepLabel,
  onComplete,
  onCancel,
}) => {
  const requiredSeconds = Math.max(
    5,
    ad.requiredViewSeconds ?? adSettings.bannerCountdownSeconds ?? 30
  );
  const autoUnlock =
    ad.autoUnlockAfterCountdown ?? adSettings.bannerAutoUnlockAfterCountdown ?? false;

  const [hasClicked, setHasClicked] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(requiredSeconds);
  const [countdownComplete, setCountdownComplete] = useState(false);
  const [imgError, setImgError] = useState(false);

  const impressionSentRef = useRef(false);
  const clickSentRef = useRef(false);
  const completeSentRef = useRef(false);
  const autoTriggeredRef = useRef(false);

  const device = detectCurrentDevice();
  const bannerImgSrc =
    device === 'mobile' && ad.mobileImageUrl ? ad.mobileImageUrl : ad.imageUrl;

  // Track impression on stage load (does NOT unlock!)
  useEffect(() => {
    setHasClicked(false);
    setRemainingSeconds(requiredSeconds);
    setCountdownComplete(false);
    setImgError(false);
    clickSentRef.current = false;
    completeSentRef.current = false;
    autoTriggeredRef.current = false;

    if (!impressionSentRef.current) {
      impressionSentRef.current = true;
      trackAdEvent(
        {
          adId: ad.id,
          adKind: 'custom',
          event: 'impression',
          contentId,
          contentType,
          placement: ad.placement || 'player',
          uid: userId || 'guest',
          device,
        },
        adSettings.testMode
      );
    }
  }, [ad.id, requiredSeconds, contentId, contentType, userId, device, adSettings.testMode, ad.placement]);

  // Countdown ONLY starts after mandatory click
  useEffect(() => {
    if (!hasClicked || countdownComplete) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          setCountdownComplete(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasClicked, countdownComplete]);

  // Record banner_complete interaction once countdown completes
  useEffect(() => {
    if (!hasClicked || !countdownComplete) return;
    if (!completeSentRef.current) {
      completeSentRef.current = true;
      trackAdEvent(
        {
          adId: ad.id,
          adKind: 'custom',
          event: 'banner_complete',
          contentId,
          contentType,
          placement: ad.placement || 'player',
          uid: userId || 'guest',
          device,
        },
        adSettings.testMode
      );
    }
    if (autoUnlock && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      const t = window.setTimeout(() => onComplete(), 450);
      return () => window.clearTimeout(t);
    }
  }, [
    hasClicked,
    countdownComplete,
    autoUnlock,
    onComplete,
    ad.id,
    ad.placement,
    contentId,
    contentType,
    userId,
    device,
    adSettings.testMode,
  ]);

  const handleBannerAnchorClick = () => {
    if (!clickSentRef.current) {
      clickSentRef.current = true;
      trackAdEvent(
        {
          adId: ad.id,
          adKind: 'custom',
          event: 'click',
          contentId,
          contentType,
          placement: ad.placement || 'player',
          uid: userId || 'guest',
          device,
        },
        adSettings.testMode
      );
    }
    if (!hasClicked) {
      setHasClicked(true);
    }
  };

  const progressPct = hasClicked
    ? Math.min(100, Math.round(((requiredSeconds - remainingSeconds) / requiredSeconds) * 100))
    : 0;

  return (
    <div
      className="mx-auto max-w-5xl px-4 py-6"
      data-testid="mandatory-banner-unlock"
    >
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0d14] text-white shadow-2xl">
        {/* Top Sponsor & Step Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/55 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-amber-500/20 px-2 py-0.5 font-bold uppercase tracking-wider text-amber-300">
              {adSettings.showAdLabel ? adSettings.adLabelText || 'Ad' : 'Sponsor'}
            </span>
            {ad.advertiserName && (
              <span className="font-semibold text-zinc-200">{ad.advertiserName}</span>
            )}
            {unlockStepLabel && (
              <span className="text-zinc-400">· {unlockStepLabel}</span>
            )}
            {adSettings.testMode && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                TEST MODE
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {hasClicked && !countdownComplete && (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/25 px-3 py-1 text-xs font-bold tabular-nums text-violet-200"
                data-testid="banner-countdown"
              >
                <Clock className="h-3.5 w-3.5" />
                {remainingSeconds}s remaining
              </span>
            )}
            {countdownComplete && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Completed
              </span>
            )}
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close advertisement without unlocking"
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-white/15 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Large Clickable Banner Surface Inside Player Stage */}
        <div className="p-4 sm:p-6">
          <a
            href={ad.redirectUrl}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={handleBannerAnchorClick}
            data-testid="mandatory-banner-link"
            className="group relative block overflow-hidden rounded-xl border-2 border-violet-500/40 bg-zinc-950 transition-all hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <div className="relative aspect-[16/9] max-h-[380px] w-full overflow-hidden bg-zinc-900">
              {!imgError && bannerImgSrc ? (
                <img
                  src={bannerImgSrc}
                  alt={ad.altText || ad.name}
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-violet-950 via-zinc-900 to-black p-6 text-center">
                  <p className="font-display text-2xl font-bold">{ad.name}</p>
                  <p className="mt-1 text-xs text-zinc-300">{ad.advertiserName || ad.redirectUrl}</p>
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/25" />

              <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-white sm:text-lg">
                    {ad.name}
                  </p>
                  <p className="truncate text-xs text-zinc-300">
                    {ad.altText || 'Sponsored partner offer · Opens in a new tab'}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg transition-colors group-hover:bg-violet-500">
                  <MousePointerClick className="h-4 w-4" />
                  Visit Advertiser
                  <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </div>
            </div>
          </a>

          {/* Status & Completion Bar */}
          <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {!hasClicked ? (
                <div className="flex items-center gap-2.5 text-sm font-semibold text-amber-300">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>
                    {adSettings.bannerPromptText || 'Click the advertisement to continue'}
                  </span>
                </div>
              ) : !countdownComplete ? (
                <div className="flex items-center gap-2.5 text-sm font-semibold text-violet-200">
                  <Clock className="h-4 w-4 shrink-0 animate-pulse text-violet-400" />
                  <span>
                    Episode stays locked while countdown completes: {remainingSeconds}s remaining
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 text-sm font-semibold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    {autoUnlock
                      ? 'Sponsor interaction complete — unlocking episode now...'
                      : 'Requirement met! Click Watch Episode to begin playback.'}
                  </span>
                </div>
              )}

              {countdownComplete ? (
                <button
                  type="button"
                  onClick={onComplete}
                  data-testid="watch-unlocked-episode-btn"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-colors hover:bg-emerald-500"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Watch Episode
                </button>
              ) : (
                <span className="rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs font-semibold text-zinc-400">
                  {hasClicked ? `Unlocking in ${remainingSeconds}s` : `Requires click + ${requiredSeconds}s`}
                </span>
              )}
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full transition-all duration-500 ${
                  countdownComplete ? 'bg-emerald-500' : 'bg-violet-500'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <p className="text-[11px] text-zinc-400">
              Both clicking the sponsor banner and waiting {requiredSeconds} seconds are required before unlocking. Early exit keeps this episode locked.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
