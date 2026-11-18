import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_AD_SETTINGS, SEED_CUSTOM_ADS, SEED_VAST_ADS } from '../data/seedAds';
import { SEED_EPISODES, SEED_MOVIES, SEED_PLANS } from '../data/seedCatalog';
import type { AdUnlockRecord, MovieItem, UserProfile } from '../types/streaming';
import {
  applyBulkQuickRulePreview,
  canConsumeUnlockQuota,
  canWatch,
  deriveSeriesAccessSummary,
  isUnlockRecordValid,
  pruneExpiredUnlocks,
  resolveEffectiveAccessRule,
  resolveTitleBadges,
} from './access';
import { selectUnlockAd } from './adEngine';

const sampleSeries = SEED_MOVIES.find((m) => m.id === 'aether-blade-chronicles')!;
const sampleEpisodes = SEED_EPISODES['aether-blade-chronicles'];

const freeUser: UserProfile = {
  uid: 'user-free-1',
  displayName: 'Free Viewer',
  email: 'free@example.com',
  photoURL: '',
  role: 'user',
  status: 'active',
  plan: 'free',
  subscriptionPlanId: null,
  subscriptionPlanName: null,
  planExpiresAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  lastLoginAt: '2026-11-01T00:00:00Z',
};

const subUser: UserProfile = {
  ...freeUser,
  uid: 'user-sub-1',
  displayName: 'Cinema Plus Member',
  plan: 'premium',
  subscriptionPlanId: 'plan-cinema-plus',
  subscriptionPlanName: 'Cinema Plus',
  planExpiresAt: '2027-11-01T00:00:00Z',
};

const expiredSubUser: UserProfile = {
  ...subUser,
  uid: 'user-expired-1',
  planExpiresAt: '2025-01-01T00:00:00Z',
};

test('resolveEffectiveAccessRule follows Episode -> Season -> Series -> Global precedence', () => {
  const baseMovie: MovieItem = {
    ...sampleSeries,
    access: {
      mode: 'subscription',
      requiredPlanId: 'plan-cinema-plus',
      requiredPlanName: 'Cinema Plus',
      adFormat: 'video',
      adsRequired: 1,
      unlockHours: 24,
    },
    seasonAccess: {
      'season-2': {
        mode: 'sub_or_ad',
        adFormat: 'banner',
        adSourceMode: 'manual',
        bannerAdIds: ['ad-mandatory-unlock-banner'],
        unlockHours: 12,
      },
    },
  };

  // Episode inheriting everything from Season 2 overrides Series subscription-only rule
  const epInheritS2 = { ...sampleEpisodes[5], seasonNumber: 2, access: { mode: 'inherit' as const } };
  const resolvedS2 = resolveEffectiveAccessRule(baseMovie, epInheritS2, DEFAULT_AD_SETTINGS);
  assert.equal(resolvedS2.mode, 'sub_or_ad');
  assert.equal(resolvedS2.adFormat, 'banner');
  assert.equal(resolvedS2.unlockHours, 12);
  assert.equal(resolvedS2.sourceLayer, 'season');

  // Episode with explicit rule overrides Season 2
  const epExplicit = {
    ...sampleEpisodes[5],
    seasonNumber: 2,
    access: { mode: 'ad_unlock' as const, adFormat: 'video' as const, adsRequired: 2 },
  };
  const resolvedEp = resolveEffectiveAccessRule(baseMovie, epExplicit, DEFAULT_AD_SETTINGS);
  assert.equal(resolvedEp.mode, 'ad_unlock');
  assert.equal(resolvedEp.adFormat, 'video');
  assert.equal(resolvedEp.adsRequired, 2);
  assert.equal(resolvedEp.sourceLayer, 'episode');

  // Episode in Season 1 (no season override) inherits Series rule
  const epInheritS1 = { ...sampleEpisodes[0], seasonNumber: 1, access: { mode: 'inherit' as const } };
  const resolvedS1 = resolveEffectiveAccessRule(baseMovie, epInheritS1, DEFAULT_AD_SETTINGS);
  assert.equal(resolvedS1.mode, 'subscription');
  assert.equal(resolvedS1.sourceLayer, 'series_or_movie');
});

test('canWatch enforces independent per-episode unlocks and subscriber bypass', () => {
  const ep1Free = sampleEpisodes[0]; // Ep 1 Free
  const ep2SubOrAd = sampleEpisodes[1]; // Ep 2 Sub or Ad (Video)
  const ep3SubOrAd = sampleEpisodes[2]; // Ep 3 Sub or Ad (Banner)
  const ep4SubOnly = sampleEpisodes[3]; // Ep 4 Sub only

  // Guest can watch Ep 1 free, blocked on Ep 2 with Watch Ad available when guestAdUnlock=true
  assert.equal(canWatch({ movie: sampleSeries, episode: ep1Free, user: null, plans: SEED_PLANS, settings: DEFAULT_AD_SETTINGS }).allowed, true);
  const guestEp2 = canWatch({ movie: sampleSeries, episode: ep2SubOrAd, user: null, plans: SEED_PLANS, settings: DEFAULT_AD_SETTINGS });
  assert.equal(guestEp2.allowed, false);
  assert.equal(guestEp2.canWatchAdToUnlock, true);
  assert.equal(guestEp2.canSubscribe, true);

  // Guest blocked from ad unlock if guestAdUnlock=false
  const guestDisabled = canWatch({
    movie: sampleSeries,
    episode: ep2SubOrAd,
    user: null,
    plans: SEED_PLANS,
    settings: { ...DEFAULT_AD_SETTINGS, guestAdUnlock: false },
  });
  assert.equal(guestDisabled.canWatchAdToUnlock, false);
  assert.equal(guestDisabled.requiresSignInForAd, true);

  // Unlocking Ep 2 grants access ONLY to Ep 2, NOT Ep 3 or Ep 4
  const now = Date.parse('2026-11-18T10:00:00Z');
  const unlocks: Record<string, AdUnlockRecord> = {
    [ep2SubOrAd.id]: {
      contentId: ep2SubOrAd.id,
      seriesId: sampleSeries.id,
      contentType: 'episode',
      uid: freeUser.uid,
      unlockedAt: '2026-11-18T09:00:00Z',
      expiresAt: '2026-11-19T09:00:00Z',
      adId: 'vast-rewarded-unlock-video',
      adKind: 'vast',
      format: 'video',
      method: 'rewarded_ad',
    },
  };
  const checkEp2 = canWatch({
    movie: sampleSeries,
    episode: ep2SubOrAd,
    user: freeUser,
    plans: SEED_PLANS,
    unlocksMap: unlocks,
    settings: DEFAULT_AD_SETTINGS,
    nowMs: now,
  });
  assert.equal(checkEp2.allowed, true);
  assert.equal(checkEp2.unlockedBy, 'ad_unlock');

  const checkEp3 = canWatch({
    movie: sampleSeries,
    episode: ep3SubOrAd,
    user: freeUser,
    plans: SEED_PLANS,
    unlocksMap: unlocks,
    settings: DEFAULT_AD_SETTINGS,
    nowMs: now,
  });
  assert.equal(checkEp3.allowed, false);
  assert.equal(checkEp3.canWatchAdToUnlock, true);

  // Ep 4 is subscription only
  const checkEp4 = canWatch({
    movie: sampleSeries,
    episode: ep4SubOnly,
    user: freeUser,
    plans: SEED_PLANS,
    unlocksMap: unlocks,
    settings: DEFAULT_AD_SETTINGS,
    nowMs: now,
  });
  assert.equal(checkEp4.allowed, false);
  assert.equal(checkEp4.canWatchAdToUnlock, false);
  assert.equal(checkEp4.canSubscribe, true);

  // Active subscriber watches Ep 2, Ep 3, Ep 4 with zero gate
  assert.equal(canWatch({ movie: sampleSeries, episode: ep4SubOnly, user: subUser, plans: SEED_PLANS, settings: DEFAULT_AD_SETTINGS, nowMs: now }).unlockedBy, 'subscriber');

  // Expired subscriber cannot bypass Ep 4
  const checkExpired = canWatch({ movie: sampleSeries, episode: ep4SubOnly, user: expiredSubUser, plans: SEED_PLANS, settings: DEFAULT_AD_SETTINGS, nowMs: now });
  assert.equal(checkExpired.allowed, false);
  assert.equal(checkExpired.reason, 'expired');
});

test('unlock validity pruning & hourly quota caps (20/hr default)', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const map: Record<string, AdUnlockRecord> = {
    valid: {
      contentId: 'valid',
      contentType: 'episode',
      uid: 'u1',
      unlockedAt: '2026-11-18T11:00:00Z',
      expiresAt: '2026-11-19T11:00:00Z',
      adId: 'a1',
      adKind: 'vast',
      format: 'video',
      method: 'rewarded_ad',
    },
    session: {
      contentId: 'session',
      contentType: 'episode',
      uid: 'u1',
      unlockedAt: '2026-11-18T11:00:00Z',
      expiresAt: null,
      sessionOnly: true,
      adId: 'a2',
      adKind: 'custom',
      format: 'banner',
      method: 'rewarded_ad',
    },
    expired: {
      contentId: 'expired',
      contentType: 'episode',
      uid: 'u1',
      unlockedAt: '2026-11-17T10:00:00Z',
      expiresAt: '2026-11-18T10:00:00Z',
      adId: 'a3',
      adKind: 'vast',
      format: 'video',
      method: 'rewarded_ad',
    },
  };
  assert.equal(isUnlockRecordValid(map.expired, now), false);
  assert.equal(isUnlockRecordValid(map.session, now), true);
  const pruned = pruneExpiredUnlocks(map, now);
  assert.deepEqual(Object.keys(pruned).sort(), ['session', 'valid']);

  // Hourly quota check
  const twentyTimestamps = Array.from({ length: 20 }, (_, i) => now - i * 60_000);
  const capped = canConsumeUnlockQuota(twentyTimestamps, 20, now);
  assert.equal(capped.allowed, false);
  assert.equal(capped.remaining, 0);

  const okQuota = canConsumeUnlockQuota(twentyTimestamps.slice(0, 19), 20, now);
  assert.equal(okQuota.allowed, true);
  assert.equal(okQuota.remaining, 1);
});

test('selectUnlockAd honors manual pinned ad deterministically and never swaps randomly', () => {
  const ctx = {
    contentType: 'tvshow' as const,
    contentId: sampleSeries.id,
    episodeId: 'abc-s1-e3',
    device: 'desktop' as const,
    user: freeUser,
  };
  const now = Date.parse('2026-11-18T10:00:00Z');

  // Pin ad-fashion-player explicitly even though ad-mandatory-unlock-banner has higher priority (10 > 6)
  for (const r of [0, 0.25, 0.5, 0.99]) {
    const choice = selectUnlockAd({
      adFormat: 'banner',
      adSourceMode: 'manual',
      pinnedBannerAdIds: ['ad-fashion-player'],
      vastAds: SEED_VAST_ADS,
      customAds: SEED_CUSTOM_ADS,
      ctx,
      nowMs: now,
      rand: () => r,
    });
    assert.ok(choice);
    assert.equal(choice.format, 'banner');
    assert.equal(choice.ad.id, 'ad-fashion-player');
    assert.equal(choice.selectionReason, 'pinned');
  }

  // Pin VAST video ad deterministically
  const vidChoice = selectUnlockAd({
    adFormat: 'video',
    adSourceMode: 'manual',
    pinnedVideoAdIds: ['vast-bigsale-preroll'],
    vastAds: SEED_VAST_ADS,
    customAds: SEED_CUSTOM_ADS,
    ctx,
    nowMs: now,
    rand: () => 0.9,
  });
  assert.ok(vidChoice);
  assert.equal(vidChoice.format, 'video');
  assert.equal(vidChoice.ad.id, 'vast-bigsale-preroll');
  assert.equal(vidChoice.selectionReason, 'pinned');
});

test('resolveTitleBadges synchronizes PAID, FREE WITH ADS, INCLUDED, Some Episodes Free & OFF-by-default FREE', () => {
  const summary = deriveSeriesAccessSummary(sampleSeries, sampleEpisodes, DEFAULT_AD_SETTINGS);
  assert.equal(summary.hasFree, true);
  assert.equal(summary.hasAdUnlock, true);
  assert.equal(summary.hasSubOnly, true);

  // Mixed series card for free user -> Some Episodes Free + PAID + FREE WITH ADS
  const seriesBadgesFree = resolveTitleBadges({
    movie: sampleSeries,
    episodesSummary: summary,
    user: freeUser,
    plans: SEED_PLANS,
    settings: DEFAULT_AD_SETTINGS,
  });
  assert.ok(seriesBadgesFree.some((b) => b.id === 'some_episodes_free'));
  assert.ok(seriesBadgesFree.some((b) => b.id === 'paid' && b.label.includes('Cinema Plus')));
  assert.ok(seriesBadgesFree.some((b) => b.id === 'free_with_ads'));

  // Free movie -> FREE badge OFF by default
  const freeMovie = SEED_MOVIES.find((m) => m.id === 'crimson-harbor')!;
  assert.equal(
    resolveTitleBadges({ movie: freeMovie, user: freeUser, settings: DEFAULT_AD_SETTINGS }).length,
    0
  );
  // Turn FREE badge ON -> appears
  const withFreeBadgeOn = {
    ...DEFAULT_AD_SETTINGS,
    badgeSettings: {
      ...DEFAULT_AD_SETTINGS.badgeSettings!,
      free: { ...DEFAULT_AD_SETTINGS.badgeSettings!.free, enabled: true },
    },
  };
  assert.equal(
    resolveTitleBadges({ movie: freeMovie, user: freeUser, settings: withFreeBadgeOn })[0]?.id,
    'free'
  );

  // Active subscriber -> INCLUDED badge
  const epSubBadges = resolveTitleBadges({
    movie: sampleSeries,
    episode: sampleEpisodes[3],
    user: subUser,
    plans: SEED_PLANS,
    settings: DEFAULT_AD_SETTINGS,
  });
  assert.equal(epSubBadges.length, 1);
  assert.equal(epSubBadges[0].id, 'included');
});

test('applyBulkQuickRulePreview generates deterministic first-N-free and every-Nth-free plans', () => {
  const s1Eps = sampleEpisodes.filter((e) => e.seasonNumber === 1);
  const diff = applyBulkQuickRulePreview({
    movie: sampleSeries,
    episodes: s1Eps,
    ruleKind: 'first_n_free_rest_sub_or_ad',
    paramN: 2,
    planId: 'plan-cinema-plus',
    planName: 'Cinema Plus',
    adFormat: 'banner',
    settings: DEFAULT_AD_SETTINGS,
  });

  assert.equal(diff.length, 5);
  assert.equal(diff[0].afterRule.mode, 'free');
  assert.equal(diff[1].afterRule.mode, 'free');
  assert.equal(diff[2].afterRule.mode, 'sub_or_ad');
  assert.equal(diff[3].afterRule.mode, 'sub_or_ad');
  assert.equal(diff[4].afterRule.adFormat, 'banner');
});
