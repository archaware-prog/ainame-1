import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Crown,
  Lock,
  LogIn,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import type {
  AdGlobalSettings,
  EpisodeItem,
  MovieItem,
  UserProfile,
} from '../../types/streaming';
import { formatMonthlyPrice } from '../../utils/catalog';
import { normalizeAdSettings, type CanWatchResult } from '../../utils/access';
import { AccessBadges } from './AccessBadges';

interface WatchGateOverlayProps {
  movie: MovieItem;
  episode?: EpisodeItem | null;
  user: UserProfile | null;
  access: CanWatchResult;
  adSettings?: AdGlobalSettings;
  adError?: string | null;
  failureCount: number;
  isOffline?: boolean;
  onBack: () => void;
  onStartAdUnlock: () => void;
  onRetryAdUnlock: () => void;
  onFallbackContinue: () => void;
  onOpenAuth: () => void;
  onSubscribeClick: (planId?: string) => void;
}

export const WatchGateOverlay: React.FC<WatchGateOverlayProps> = ({
  movie,
  episode = null,
  user,
  access,
  adSettings,
  adError = null,
  failureCount,
  isOffline = false,
  onBack,
  onStartAdUnlock,
  onRetryAdUnlock,
  onFallbackContinue,
  onOpenAuth,
  onSubscribeClick,
}) => {
  const cfg = normalizeAdSettings(adSettings);
  const planName = access.requiredPlan?.name ?? access.requiredPlanName ?? 'Cinema Plus';
  const priceLabel = access.requiredPlan
    ? formatMonthlyPrice(access.requiredPlan.pricePerMonth, access.requiredPlan.currency)
    : '';
  const adFormatLabel =
    access.effectiveRule.adFormat === 'banner'
      ? `Banner · ${cfg.bannerCountdownSeconds || 30}s`
      : cfg.watchAdSubtext || 'Free · About 30 seconds';

  const fallbackUnlockedAvailable =
    failureCount >= 2 && cfg.failureFallback === 'free_once' && access.canWatchAdToUnlock;

  const isSignInRequiredOnly = access.reason === 'sign_in_required';
  const showPurpleAdButton =
    !isSignInRequiredOnly && access.canWatchAdToUnlock && !access.quotaExceeded;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-10" data-testid="watch-gate-overlay">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Details
      </button>

      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-[#0d0d14] text-white shadow-2xl">
        {/* Blurred Poster / Backdrop */}
        <img
          src={episode?.thumbnailUrl || movie.bannerUrl || movie.posterUrl}
          alt={movie.title}
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full scale-105 object-cover opacity-30 blur-md"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090f] via-[#0b0b12]/80 to-[#09090f]/75" />

        <div className="relative z-10 mx-auto flex min-h-[420px] max-w-xl flex-col items-center justify-center px-6 py-12 text-center sm:px-10">
          {/* Top Context + Orange Subscription Badge */}
          <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
            <AccessBadges
              movie={movie}
              episode={episode}
              user={user}
              plans={access.requiredPlan ? [access.requiredPlan] : []}
              adSettings={cfg}
              size="md"
            />
            {episode && (
              <span className="rounded bg-white/10 px-2.5 py-1 text-xs font-medium text-zinc-200">
                S{episode.seasonNumber} · E{episode.number}: {episode.title}
              </span>
            )}
          </div>

          {/* Lock / Auth Icon */}
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-500/35 bg-orange-500/15 text-orange-400 shadow-lg">
            {isSignInRequiredOnly ? <LogIn className="h-7 w-7" /> : <Lock className="h-7 w-7" />}
          </div>

          {/* Editable Gate Title & Description */}
          <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {isSignInRequiredOnly
              ? 'Sign In to Watch'
              : access.reason === 'expired'
              ? `Membership Expired · ${planName}`
              : cfg.gateTitle || 'Unlock this episode'}
          </h1>

          <p className="mt-2.5 max-w-md text-sm leading-relaxed text-zinc-300">
            {isSignInRequiredOnly
              ? `“${movie.title}” is free to stream for signed-in members. Sign in to return to this exact episode immediately.`
              : access.canWatchAdToUnlock
              ? cfg.gateDescription ||
                'Watch a short ad to play this episode for free, or subscribe to Cinema Plus for unlimited ad-free viewing.'
              : `“${episode ? episode.title : movie.title}” requires an active ${planName} subscription${
                  priceLabel ? ` (${priceLabel})` : ''
                }.`}
          </p>

          {/* Offline Notice */}
          {isOffline && (
            <div className="mt-4 flex w-full max-w-md items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-left text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>You appear to be offline. Connect to the internet to load sponsor ads or verify access.</span>
            </div>
          )}

          {/* Quota Exhausted Notice */}
          {access.quotaExceeded && cfg.adUnlockEnabled && (
            <div className="mt-4 flex w-full max-w-md items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-left text-xs text-amber-200">
              <Clock className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Hourly free ad unlock limit reached ({cfg.maxUnlocksPerHour || 20}/hour). Subscribe to {planName} for unlimited instant viewing.
              </span>
            </div>
          )}

          {/* Ad Failure + Retry + 2-Failure Admin Fallback */}
          {adError && (
            <div
              className="mt-4 w-full max-w-md space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-left text-xs text-rose-200"
              role="alert"
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div>
                  <p className="font-semibold text-rose-100">Advertisement could not complete</p>
                  <p className="mt-0.5 text-rose-200/90">{adError}</p>
                  {failureCount >= 2 && cfg.failureFallback === 'keep_locked' && (
                    <p className="mt-1 text-[11px] text-amber-200">
                      After repeated ad errors, this content stays locked. Disable any ad blocker and try again, or subscribe to {planName}.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={onRetryAdUnlock}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </button>
                {fallbackUnlockedAvailable && (
                  <button
                    type="button"
                    onClick={onFallbackContinue}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Continue Free (One-Time Fallback)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Primary Action Stack */}
          <div className="mt-6 flex w-full max-w-sm flex-col items-center gap-3">
            {/* Guest Sign-In Button */}
            {!user && (
              <button
                type="button"
                onClick={onOpenAuth}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all ${
                  showPurpleAdButton
                    ? 'border border-white/25 bg-white/10 text-white hover:bg-white/20'
                    : 'bg-[var(--kv-accent,#e50914)] text-white shadow-lg hover:opacity-90'
                }`}
              >
                <LogIn className="h-4 w-4" />
                Sign In to Watch
              </button>
            )}

            {/* Watch Ad to Unlock (Purple Primary CTA) */}
            {showPurpleAdButton && (
              <div className="w-full space-y-1.5">
                <button
                  type="button"
                  onClick={onStartAdUnlock}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-950/50 transition-all hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {cfg.watchAdButtonText || 'Watch Ad to Unlock'}
                </button>
                <p className="text-xs font-medium text-zinc-400">{adFormatLabel}</p>
              </div>
            )}

            {/* Outlined Cinema Plus Subscription Plan Button */}
            {access.canSubscribe && (
              <div className="w-full space-y-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => onSubscribeClick(access.requiredPlan?.id)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-orange-400/50 bg-orange-500/10 px-5 py-3 text-sm font-semibold text-orange-200 transition-colors hover:bg-orange-500/20"
                >
                  <Crown className="h-4 w-4 text-orange-400" />
                  <span>
                    {cfg.subscribeButtonText || 'View Cinema Plus Plan'}
                    {priceLabel ? ` (${priceLabel})` : ''}
                  </span>
                </button>
                <p className="text-[11px] text-zinc-400">
                  Subscribers watch without ads.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
