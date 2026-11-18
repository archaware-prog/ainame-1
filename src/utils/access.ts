import { DEFAULT_AD_SETTINGS, DEFAULT_BADGE_SETTINGS } from '../data/seedAds';
import type {
  AccessAdFormat,
  AccessMode,
  AdGlobalSettings,
  AdSourceMode,
  AdUnlockRecord,
  BadgeCustomizationSettings,
  BadgeIconKind,
  ContentAccessRule,
  EpisodeItem,
  MovieItem,
  SeriesEpisodeSummary,
  SubscriptionPlan,
  UserProfile,
} from '../types/streaming';

export interface ResolvedAccessRule {
  mode: Exclude<AccessMode, 'inherit'>;
  requiredPlanId: string | null;
  requiredPlanName: string | null;
  adFormat: Exclude<AccessAdFormat, 'inherit'>;
  adSourceMode: AdSourceMode;
  videoAdIds: string[];
  bannerAdIds: string[];
  adsRequired: number;
  unlockHours: number;
  sourceLayer: 'episode' | 'season' | 'series_or_movie' | 'global';
}

export interface CanWatchInput {
  movie: MovieItem;
  episode?: EpisodeItem | null;
  user: UserProfile | null;
  plans?: SubscriptionPlan[];
  unlocksMap?: Record<string, AdUnlockRecord>;
  settings?: AdGlobalSettings;
  recentUnlockTimestamps?: number[];
  nowMs?: number;
}

export interface CanWatchResult {
  allowed: boolean;
  unlockedBy: 'free' | 'subscriber' | 'admin' | 'ad_unlock' | 'fallback_once' | 'locked';
  reason:
    | 'free'
    | 'sign_in_required'
    | 'subscription_required'
    | 'sub_or_ad'
    | 'ad_unlock_only'
    | 'expired'
    | 'quota_exceeded';
  effectiveRule: ResolvedAccessRule;
  unlockKey: string;
  canWatchAdToUnlock: boolean;
  canSubscribe: boolean;
  requiresSignInForAd: boolean;
  quotaRemaining: number;
  quotaExceeded: boolean;
  requiredPlan?: SubscriptionPlan;
  requiredPlanName?: string;
  activeUnlock?: AdUnlockRecord;
}

export interface ResolvedBadgeItem {
  id: 'paid' | 'free_with_ads' | 'free' | 'included' | 'some_episodes_free' | 'unlocked';
  label: string;
  shortLabel: string;
  tooltip: string;
  color: string;
  icon: BadgeIconKind;
  compactOnly: boolean;
}

export type BulkQuickRuleKind =
  | 'first_n_free_rest_sub_or_ad'
  | 'first_n_free_rest_sub_only'
  | 'all_sub_or_ad'
  | 'all_ad_only'
  | 'all_sub_only'
  | 'every_nth_free'
  | 'all_free';

export interface BulkDiffRow {
  episodeId: string;
  seriesId: string;
  seasonId: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  beforeMode: Exclude<AccessMode, 'inherit'>;
  afterRule: ContentAccessRule;
  changed: boolean;
}

export function normalizeAdSettings(settings?: Partial<AdGlobalSettings>): AdGlobalSettings {
  const mergedBadges: BadgeCustomizationSettings = {
    showPlanNameOnPaid:
      settings?.badgeSettings?.showPlanNameOnPaid ?? DEFAULT_BADGE_SETTINGS.showPlanNameOnPaid,
    collapseOnMobile:
      settings?.badgeSettings?.collapseOnMobile ?? DEFAULT_BADGE_SETTINGS.collapseOnMobile,
    paid: { ...DEFAULT_BADGE_SETTINGS.paid, ...settings?.badgeSettings?.paid },
    freeWithAds: { ...DEFAULT_BADGE_SETTINGS.freeWithAds, ...settings?.badgeSettings?.freeWithAds },
    free: { ...DEFAULT_BADGE_SETTINGS.free, ...settings?.badgeSettings?.free },
    included: { ...DEFAULT_BADGE_SETTINGS.included, ...settings?.badgeSettings?.included },
    someEpisodesFree: {
      ...DEFAULT_BADGE_SETTINGS.someEpisodesFree,
      ...settings?.badgeSettings?.someEpisodesFree,
    },
  };

  return {
    ...DEFAULT_AD_SETTINGS,
    ...(settings || {}),
    badgeSettings: mergedBadges,
  };
}

export function deriveLegacyTitleRule(movie: MovieItem): ContentAccessRule {
  if (movie.access && movie.access.mode !== 'inherit') {
    return movie.access;
  }
  const hasPlan = Boolean(movie.requiredPlanId) || movie.isPremium;
  if (hasPlan) {
    return {
      mode: 'subscription',
      requiredPlanId: movie.requiredPlanId ?? null,
      requiredPlanName: movie.requiredPlanName ?? null,
      adFormat: movie.defaultAdFormat ?? 'inherit',
    };
  }
  return {
    mode: 'free',
    requiredPlanId: null,
    requiredPlanName: null,
    adFormat: movie.defaultAdFormat ?? 'inherit',
  };
}

export function resolveEffectiveAccessRule(
  movie: MovieItem,
  episode?: EpisodeItem | null,
  settings?: AdGlobalSettings
): ResolvedAccessRule {
  const normalized = normalizeAdSettings(settings);
  const seasonKey = episode ? `season-${episode.seasonNumber}` : undefined;
  const seasonRule = seasonKey ? movie.seasonAccess?.[seasonKey] : undefined;
  const titleRule = movie.access;
  const legacyRule = deriveLegacyTitleRule(movie);

  let mode: Exclude<AccessMode, 'inherit'> = 'free';
  let sourceLayer: ResolvedAccessRule['sourceLayer'] = 'global';

  if (episode?.access?.mode && episode.access.mode !== 'inherit') {
    mode = episode.access.mode;
    sourceLayer = 'episode';
  } else if (seasonRule?.mode && seasonRule.mode !== 'inherit') {
    mode = seasonRule.mode;
    sourceLayer = 'season';
  } else if (titleRule?.mode && titleRule.mode !== 'inherit') {
    mode = titleRule.mode;
    sourceLayer = 'series_or_movie';
  } else if (legacyRule.mode && legacyRule.mode !== 'inherit') {
    mode = legacyRule.mode;
    sourceLayer = 'series_or_movie';
  }

  const requiredPlanId =
    episode?.access?.requiredPlanId ??
    seasonRule?.requiredPlanId ??
    titleRule?.requiredPlanId ??
    movie.requiredPlanId ??
    null;

  const requiredPlanName =
    episode?.access?.requiredPlanName ??
    seasonRule?.requiredPlanName ??
    titleRule?.requiredPlanName ??
    movie.requiredPlanName ??
    null;

  const pickFormat = (): Exclude<AccessAdFormat, 'inherit'> => {
    const candidates: Array<AccessAdFormat | undefined> = [
      episode?.access?.adFormat,
      seasonRule?.adFormat,
      titleRule?.adFormat,
      movie.defaultAdFormat,
      normalized.defaultUnlockAdFormat,
    ];
    for (const fmt of candidates) {
      if (fmt && fmt !== 'inherit') return fmt;
    }
    return 'video';
  };

  const adSourceMode: AdSourceMode =
    episode?.access?.adSourceMode ??
    seasonRule?.adSourceMode ??
    titleRule?.adSourceMode ??
    'auto';

  const videoAdIds =
    (episode?.access?.videoAdIds?.length ? episode.access.videoAdIds : undefined) ??
    (seasonRule?.videoAdIds?.length ? seasonRule.videoAdIds : undefined) ??
    (titleRule?.videoAdIds?.length ? titleRule.videoAdIds : undefined) ??
    [];

  const bannerAdIds =
    (episode?.access?.bannerAdIds?.length ? episode.access.bannerAdIds : undefined) ??
    (seasonRule?.bannerAdIds?.length ? seasonRule.bannerAdIds : undefined) ??
    (titleRule?.bannerAdIds?.length ? titleRule.bannerAdIds : undefined) ??
    [];

  const adsRequiredRaw =
    episode?.access?.adsRequired ??
    seasonRule?.adsRequired ??
    titleRule?.adsRequired ??
    1;
  const adsRequired = Math.max(1, Math.min(3, Math.round(adsRequiredRaw || 1)));

  const unlockHoursRaw =
    episode?.access?.unlockHours ??
    seasonRule?.unlockHours ??
    titleRule?.unlockHours ??
    normalized.defaultUnlockValidityHours ??
    24;
  const unlockHours = Math.max(0, Number.isFinite(unlockHoursRaw) ? unlockHoursRaw : 24);

  return {
    mode,
    requiredPlanId,
    requiredPlanName,
    adFormat: pickFormat(),
    adSourceMode,
    videoAdIds,
    bannerAdIds,
    adsRequired,
    unlockHours,
    sourceLayer,
  };
}

export function isUnlockRecordValid(
  record: AdUnlockRecord | undefined | null,
  nowMs = Date.now()
): boolean {
  if (!record) return false;
  if (record.sessionOnly || record.expiresAt === null) {
    return true;
  }
  const expMs = Date.parse(record.expiresAt);
  if (Number.isNaN(expMs)) return false;
  return expMs > nowMs;
}

export function pruneExpiredUnlocks(
  unlocksMap: Record<string, AdUnlockRecord>,
  nowMs = Date.now()
): Record<string, AdUnlockRecord> {
  const next: Record<string, AdUnlockRecord> = {};
  for (const [key, rec] of Object.entries(unlocksMap)) {
    if (isUnlockRecordValid(rec, nowMs)) {
      next[key] = rec;
    }
  }
  return next;
}

export function getRecentUnlockTimestamps(timestamps: number[], nowMs = Date.now()): number[] {
  const oneHourAgo = nowMs - 60 * 60 * 1000;
  return timestamps.filter((ts) => Number.isFinite(ts) && ts >= oneHourAgo && ts <= nowMs + 60_000);
}

export function canConsumeUnlockQuota(
  timestamps: number[],
  maxPerHour = 20,
  nowMs = Date.now()
): { allowed: boolean; remaining: number; resetSeconds: number } {
  if (!maxPerHour || maxPerHour <= 0) {
    return { allowed: true, remaining: 999, resetSeconds: 0 };
  }
  const recent = getRecentUnlockTimestamps(timestamps, nowMs).sort((a, b) => a - b);
  const remaining = Math.max(0, maxPerHour - recent.length);
  if (recent.length < maxPerHour) {
    return { allowed: true, remaining, resetSeconds: 0 };
  }
  const oldest = recent[0];
  const resetMs = oldest + 60 * 60 * 1000 - nowMs;
  return {
    allowed: false,
    remaining: 0,
    resetSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
  };
}

export function hasActiveSubscription(
  user: UserProfile | null,
  requiredPlanId?: string | null,
  nowMs = Date.now()
): { active: boolean; expired: boolean } {
  if (!user) return { active: false, expired: false };
  if (user.role === 'admin') return { active: true, expired: false };

  const expiresMs = user.planExpiresAt ? Date.parse(user.planExpiresAt) : NaN;
  const isExpired = Boolean(user.planExpiresAt && !Number.isNaN(expiresMs) && expiresMs < nowMs);
  if (isExpired) {
    return { active: false, expired: true };
  }

  const isPremium = user.plan === 'premium' || Boolean(user.subscriptionPlanId);
  if (!isPremium) return { active: false, expired: false };

  if (requiredPlanId) {
    return {
      active: user.subscriptionPlanId === requiredPlanId || !user.subscriptionPlanId,
      expired: false,
    };
  }
  return { active: true, expired: false };
}

export function getContentUnlockKey(movie: MovieItem, episode?: EpisodeItem | null): string {
  return episode ? episode.id : movie.id;
}

export function canWatch(input: CanWatchInput): CanWatchResult {
  const {
    movie,
    episode = null,
    user,
    plans = [],
    unlocksMap = {},
    settings,
    recentUnlockTimestamps = [],
    nowMs = Date.now(),
  } = input;

  const normalized = normalizeAdSettings(settings);
  const effectiveRule = resolveEffectiveAccessRule(movie, episode, normalized);
  const unlockKey = getContentUnlockKey(movie, episode);

  const requiredPlan = effectiveRule.requiredPlanId
    ? plans.find((p) => p.id === effectiveRule.requiredPlanId)
    : plans.find((p) => p.isActive);
  const requiredPlanName =
    requiredPlan?.name ?? effectiveRule.requiredPlanName ?? 'Cinema Plus';

  // Admin override always plays immediately
  if (user?.role === 'admin') {
    return {
      allowed: true,
      unlockedBy: 'admin',
      reason: 'free',
      effectiveRule,
      unlockKey,
      canWatchAdToUnlock: false,
      canSubscribe: false,
      requiresSignInForAd: false,
      quotaRemaining: normalized.maxUnlocksPerHour ?? 20,
      quotaExceeded: false,
      requiredPlan,
      requiredPlanName,
    };
  }

  // Legacy sign-in-only free check (only when mode === 'free' and requiresSignIn === true)
  const legacySignInOnly =
    effectiveRule.mode === 'free' &&
    Boolean(movie.requiresSignIn) &&
    !movie.isPremium &&
    !movie.requiredPlanId;

  if (legacySignInOnly && !user) {
    return {
      allowed: false,
      unlockedBy: 'locked',
      reason: 'sign_in_required',
      effectiveRule,
      unlockKey,
      canWatchAdToUnlock: false,
      canSubscribe: false,
      requiresSignInForAd: false,
      quotaRemaining: normalized.maxUnlocksPerHour ?? 20,
      quotaExceeded: false,
      requiredPlan,
      requiredPlanName,
    };
  }

  if (effectiveRule.mode === 'free') {
    return {
      allowed: true,
      unlockedBy: 'free',
      reason: 'free',
      effectiveRule,
      unlockKey,
      canWatchAdToUnlock: false,
      canSubscribe: false,
      requiresSignInForAd: false,
      quotaRemaining: normalized.maxUnlocksPerHour ?? 20,
      quotaExceeded: false,
      requiredPlan,
      requiredPlanName,
    };
  }

  // Active subscriber check (subscribers bypass ads and paywalls, unless title strictly requires specific plan or ad_unlock_only)
  const subCheck = hasActiveSubscription(user, effectiveRule.requiredPlanId, nowMs);
  if (subCheck.active && (effectiveRule.mode === 'subscription' || effectiveRule.mode === 'sub_or_ad' || effectiveRule.mode === 'ad_unlock')) {
    return {
      allowed: true,
      unlockedBy: 'subscriber',
      reason: 'free',
      effectiveRule,
      unlockKey,
      canWatchAdToUnlock: false,
      canSubscribe: false,
      requiresSignInForAd: false,
      quotaRemaining: normalized.maxUnlocksPerHour ?? 20,
      quotaExceeded: false,
      requiredPlan,
      requiredPlanName,
    };
  }

  // Independent unlock record check (per episode or per movie)
  const activeUnlock = unlocksMap[unlockKey];
  if (isUnlockRecordValid(activeUnlock, nowMs) && (effectiveRule.mode === 'sub_or_ad' || effectiveRule.mode === 'ad_unlock')) {
    return {
      allowed: true,
      unlockedBy: activeUnlock.method === 'fallback_once' ? 'fallback_once' : 'ad_unlock',
      reason: 'free',
      effectiveRule,
      unlockKey,
      canWatchAdToUnlock: false,
      canSubscribe: effectiveRule.mode === 'sub_or_ad',
      requiresSignInForAd: false,
      quotaRemaining: normalized.maxUnlocksPerHour ?? 20,
      quotaExceeded: false,
      requiredPlan,
      requiredPlanName,
      activeUnlock,
    };
  }

  // Quota check for rewarded ad unlocking
  const quota = canConsumeUnlockQuota(
    recentUnlockTimestamps,
    normalized.maxUnlocksPerHour ?? 20,
    nowMs
  );

  const supportsAd =
    (effectiveRule.mode === 'sub_or_ad' || effectiveRule.mode === 'ad_unlock') &&
    Boolean(normalized.adUnlockEnabled);
  const canGuestUnlock = Boolean(user) || Boolean(normalized.guestAdUnlock);
  const canWatchAdToUnlock = supportsAd && canGuestUnlock && quota.allowed;
  const requiresSignInForAd = supportsAd && !user && !normalized.guestAdUnlock;
  const canSubscribe =
    effectiveRule.mode === 'subscription' || effectiveRule.mode === 'sub_or_ad';

  const reason: CanWatchResult['reason'] = subCheck.expired
    ? 'expired'
    : !quota.allowed && supportsAd
    ? 'quota_exceeded'
    : effectiveRule.mode === 'subscription'
    ? 'subscription_required'
    : effectiveRule.mode === 'ad_unlock'
    ? 'ad_unlock_only'
    : 'sub_or_ad';

  return {
    allowed: false,
    unlockedBy: 'locked',
    reason,
    effectiveRule,
    unlockKey,
    canWatchAdToUnlock,
    canSubscribe,
    requiresSignInForAd,
    quotaRemaining: quota.remaining,
    quotaExceeded: !quota.allowed,
    requiredPlan,
    requiredPlanName,
  };
}

export function deriveSeriesAccessSummary(
  movie: MovieItem,
  episodes: EpisodeItem[],
  settings?: AdGlobalSettings
): SeriesEpisodeSummary {
  if (episodes.length === 0) {
    const rule = resolveEffectiveAccessRule(movie, null, settings);
    return {
      hasFree: rule.mode === 'free',
      hasAdUnlock: rule.mode === 'ad_unlock' || rule.mode === 'sub_or_ad',
      hasSubOnly: rule.mode === 'subscription',
      totalEpisodes: 0,
    };
  }

  let hasFree = false;
  let hasAdUnlock = false;
  let hasSubOnly = false;
  for (const ep of episodes) {
    const rule = resolveEffectiveAccessRule(movie, ep, settings);
    if (rule.mode === 'free') hasFree = true;
    else if (rule.mode === 'ad_unlock' || rule.mode === 'sub_or_ad') hasAdUnlock = true;
    else if (rule.mode === 'subscription') hasSubOnly = true;
  }
  return {
    hasFree,
    hasAdUnlock,
    hasSubOnly,
    totalEpisodes: episodes.length,
  };
}

export function resolveTitleBadges(params: {
  movie: MovieItem;
  episode?: EpisodeItem | null;
  episodesSummary?: SeriesEpisodeSummary;
  user: UserProfile | null;
  plans?: SubscriptionPlan[];
  unlocksMap?: Record<string, AdUnlockRecord>;
  settings?: AdGlobalSettings;
  isMobile?: boolean;
  nowMs?: number;
}): ResolvedBadgeItem[] {
  const {
    movie,
    episode = null,
    episodesSummary,
    user,
    plans = [],
    unlocksMap = {},
    settings,
    isMobile = false,
    nowMs = Date.now(),
  } = params;

  const normalized = normalizeAdSettings(settings);
  const badgesCfg = normalized.badgeSettings ?? DEFAULT_BADGE_SETTINGS;
  const compact = Boolean(isMobile && badgesCfg.collapseOnMobile);
  const result: ResolvedBadgeItem[] = [];

  const evalRes = canWatch({
    movie,
    episode,
    user,
    plans,
    unlocksMap,
    settings: normalized,
    nowMs,
  });

  const subCheck = hasActiveSubscription(user, evalRes.effectiveRule.requiredPlanId, nowMs);
  const mode = evalRes.effectiveRule.mode;

  // Mixed series special badge when evaluating a series card (not a single episode)
  if (
    !episode &&
    movie.type === 'series' &&
    episodesSummary &&
    episodesSummary.totalEpisodes > 0 &&
    episodesSummary.hasFree &&
    (episodesSummary.hasAdUnlock || episodesSummary.hasSubOnly) &&
    badgesCfg.someEpisodesFree.enabled
  ) {
    result.push({
      id: 'some_episodes_free',
      label: badgesCfg.someEpisodesFree.label,
      shortLabel: 'Ep 1 Free',
      tooltip: `${badgesCfg.someEpisodesFree.label} — Select episodes can be streamed free`,
      color: badgesCfg.someEpisodesFree.color,
      icon: badgesCfg.someEpisodesFree.icon,
      compactOnly: compact,
    });
  }

  // Unlocked via Ad Badge on already-unlocked episode/movie
  if (evalRes.unlockedBy === 'ad_unlock' || evalRes.unlockedBy === 'fallback_once') {
    result.push({
      id: 'unlocked',
      label: 'Unlocked',
      shortLabel: 'Open',
      tooltip: 'Unlocked for this episode',
      color: badgesCfg.included.color,
      icon: 'check',
      compactOnly: compact,
    });
    return result;
  }

  // Subscriber INCLUDED badge
  if (subCheck.active && mode !== 'free') {
    if (badgesCfg.included.enabled) {
      result.push({
        id: 'included',
        label: badgesCfg.included.label,
        shortLabel: 'Sub',
        tooltip: `${badgesCfg.included.label} with your ${evalRes.requiredPlanName || 'Cinema Plus'} plan`,
        color: badgesCfg.included.color,
        icon: badgesCfg.included.icon,
        compactOnly: compact,
      });
    }
    return result;
  }

  // Non-subscriber states
  if (mode === 'free') {
    if (badgesCfg.free.enabled) {
      result.push({
        id: 'free',
        label: badgesCfg.free.label,
        shortLabel: 'Free',
        tooltip: 'Free to stream',
        color: badgesCfg.free.color,
        icon: badgesCfg.free.icon,
        compactOnly: compact,
      });
    }
    return result;
  }

  if (mode === 'ad_unlock') {
    if (badgesCfg.freeWithAds.enabled && normalized.adUnlockEnabled) {
      result.push({
        id: 'free_with_ads',
        label: badgesCfg.freeWithAds.label,
        shortLabel: 'Ad Free*',
        tooltip: `${badgesCfg.freeWithAds.label} — Watch a short ad to unlock`,
        color: badgesCfg.freeWithAds.color,
        icon: badgesCfg.freeWithAds.icon,
        compactOnly: compact,
      });
    }
    return result;
  }

  if (mode === 'sub_or_ad') {
    if (badgesCfg.paid.enabled) {
      const planLabel = badgesCfg.showPlanNameOnPaid && evalRes.requiredPlanName
        ? `${badgesCfg.paid.label} · ${evalRes.requiredPlanName}`
        : badgesCfg.paid.label;
      result.push({
        id: 'paid',
        label: planLabel,
        shortLabel: badgesCfg.paid.label,
        tooltip: `Requires ${evalRes.requiredPlanName || 'subscription'} or watch an ad`,
        color: badgesCfg.paid.color,
        icon: badgesCfg.paid.icon,
        compactOnly: compact,
      });
    }
    if (badgesCfg.freeWithAds.enabled && normalized.adUnlockEnabled) {
      result.push({
        id: 'free_with_ads',
        label: badgesCfg.freeWithAds.label,
        shortLabel: 'Ad',
        tooltip: `${badgesCfg.freeWithAds.label} — Watch a short ad to unlock`,
        color: badgesCfg.freeWithAds.color,
        icon: badgesCfg.freeWithAds.icon,
        compactOnly: compact,
      });
    }
    return result;
  }

  // Subscription-only
  if (mode === 'subscription' && badgesCfg.paid.enabled) {
    const planLabel = badgesCfg.showPlanNameOnPaid && evalRes.requiredPlanName
      ? `${badgesCfg.paid.label} · ${evalRes.requiredPlanName}`
      : badgesCfg.paid.label;
    result.push({
      id: 'paid',
      label: planLabel,
      shortLabel: badgesCfg.paid.label,
      tooltip: `Requires ${evalRes.requiredPlanName || 'Cinema Plus'} subscription`,
      color: badgesCfg.paid.color,
      icon: badgesCfg.paid.icon,
      compactOnly: compact,
    });
  }

  return result;
}

export function applyBulkQuickRulePreview(params: {
  movie: MovieItem;
  episodes: EpisodeItem[];
  targetEpisodeIds?: Set<string>;
  ruleKind: BulkQuickRuleKind;
  paramN?: number;
  planId?: string | null;
  planName?: string | null;
  adFormat?: AccessAdFormat;
  adSourceMode?: AdSourceMode;
  videoAdIds?: string[];
  bannerAdIds?: string[];
  adsRequired?: number;
  unlockHours?: number;
  settings?: AdGlobalSettings;
}): BulkDiffRow[] {
  const {
    movie,
    episodes,
    targetEpisodeIds,
    ruleKind,
    paramN = 1,
    planId = 'plan-cinema-plus',
    planName = 'Cinema Plus',
    adFormat = 'video',
    adSourceMode = 'auto',
    videoAdIds = [],
    bannerAdIds = [],
    adsRequired = 1,
    unlockHours = 24,
    settings,
  } = params;

  const n = Math.max(1, Math.round(paramN));
  const sorted = [...episodes].sort(
    (a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number
  );

  return sorted
    .filter((ep) => !targetEpisodeIds || targetEpisodeIds.size === 0 || targetEpisodeIds.has(ep.id))
    .map((ep) => {
      const before = resolveEffectiveAccessRule(movie, ep, settings);
      let nextMode: Exclude<AccessMode, 'inherit'> = 'sub_or_ad';

      switch (ruleKind) {
        case 'first_n_free_rest_sub_or_ad':
          nextMode = ep.number <= n ? 'free' : 'sub_or_ad';
          break;
        case 'first_n_free_rest_sub_only':
          nextMode = ep.number <= n ? 'free' : 'subscription';
          break;
        case 'all_sub_or_ad':
          nextMode = 'sub_or_ad';
          break;
        case 'all_ad_only':
          nextMode = 'ad_unlock';
          break;
        case 'all_sub_only':
          nextMode = 'subscription';
          break;
        case 'every_nth_free':
          nextMode = ep.number % n === 0 ? 'free' : 'sub_or_ad';
          break;
        case 'all_free':
          nextMode = 'free';
          break;
      }

      const afterRule: ContentAccessRule =
        nextMode === 'free'
          ? { mode: 'free', updatedAt: new Date().toISOString() }
          : {
              mode: nextMode,
              requiredPlanId: nextMode === 'ad_unlock' ? null : planId,
              requiredPlanName: nextMode === 'ad_unlock' ? null : planName,
              adFormat: nextMode === 'subscription' ? 'inherit' : adFormat,
              adSourceMode,
              videoAdIds: adSourceMode === 'manual' ? videoAdIds : [],
              bannerAdIds: adSourceMode === 'manual' ? bannerAdIds : [],
              adsRequired,
              unlockHours,
              updatedAt: new Date().toISOString(),
            };

      const changed =
        before.mode !== afterRule.mode ||
        (nextMode !== 'free' &&
          (before.adFormat !== (afterRule.adFormat ?? before.adFormat) ||
            before.requiredPlanId !== (afterRule.requiredPlanId ?? null) ||
            before.adSourceMode !== (afterRule.adSourceMode ?? 'auto')));

      return {
        episodeId: ep.id,
        seriesId: ep.seriesId,
        seasonId: ep.seasonId,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
        episodeTitle: ep.title,
        beforeMode: before.mode,
        afterRule,
        changed,
      };
    });
}
