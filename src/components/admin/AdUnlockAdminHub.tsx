import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crown,
  Database,
  Download,
  Edit3,
  Eye,
  Film,
  Image as ImageIcon,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tv,
  Zap,
} from 'lucide-react';
import type {
  AccessAdFormat,
  AccessMode,
  AdEventItem,
  AdGlobalSettings,
  AdSourceMode,
  BadgeCustomizationSettings,
  BadgeIconKind,
  BadgeStyleConfig,
  ContentAccessRule,
  CustomAdItem,
  EpisodeItem,
  FailureFallbackMode,
  MovieItem,
  SubscriptionPlan,
  UserProfile,
  VastAdItem,
} from '../../types/streaming';
import { SEED_EPISODES } from '../../data/seedCatalog';
import { fetchSeriesEpisodes, saveEpisodeDoc, saveMovieDoc } from '../../lib/firebase';
import { readLocalFunnelEvents } from '../../lib/adsFirebase';
import { saveBulkAccessUpdates } from '../../lib/unlocksFirebase';
import {
  applyBulkQuickRulePreview,
  canWatch,
  deriveSeriesAccessSummary,
  normalizeAdSettings,
  resolveEffectiveAccessRule,
  type BulkQuickRuleKind,
} from '../../utils/access';
import {
  buildUnlockFunnelSummary,
  formatReportTimestamp,
  generateUnlockFunnelCsv,
  selectUnlockAd,
} from '../../utils/adEngine';
import { AccessBadges } from '../user/AccessBadges';
import { MandatoryBannerUnlock } from '../user/MandatoryBannerUnlock';
import { VastPlayerOverlay } from '../user/VastPlayerOverlay';
import { WatchGateOverlay } from '../user/WatchGateOverlay';
import { CustomAdFormModal, type EpisodeOption, VastAdFormModal } from './AdModals';

type HubSection = 'access' | 'bulk' | 'creatives' | 'settings' | 'simulator' | 'reports';

interface AdUnlockAdminHubProps {
  movies: MovieItem[];
  plans: SubscriptionPlan[];
  customAds: CustomAdItem[];
  vastAds: VastAdItem[];
  adEvents: AdEventItem[];
  adSettings: AdGlobalSettings;
  adminUid: string;
  adminName: string;
  onUpdateMovie: (updated: MovieItem) => void;
  onSaveCustomAd: (ad: CustomAdItem, isNew: boolean) => Promise<void>;
  onSaveVastAd: (ad: VastAdItem, isNew: boolean) => Promise<void>;
  onSaveAdSettings: (next: AdGlobalSettings) => Promise<void>;
  onSeedCatalog: () => Promise<void>;
  onSeedSampleAds: () => Promise<void>;
  onNotify: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const ACCESS_MODE_OPTIONS: Array<{ value: AccessMode; label: string }> = [
  { value: 'inherit', label: 'Inherit Parent' },
  { value: 'free', label: 'Free (Public)' },
  { value: 'sub_or_ad', label: 'Subscription OR Watch Ad' },
  { value: 'ad_unlock', label: 'Watch Ad Only' },
  { value: 'subscription', label: 'Subscription Only' },
];

const AD_FORMAT_OPTIONS: Array<{ value: AccessAdFormat; label: string }> = [
  { value: 'inherit', label: 'Inherit Default' },
  { value: 'video', label: 'VAST Video Ad' },
  { value: 'banner', label: 'Mandatory-Click Banner' },
  { value: 'auto', label: 'Auto (Video fallback Banner)' },
];

const AD_SOURCE_OPTIONS: Array<{ value: AdSourceMode; label: string }> = [
  { value: 'auto', label: 'Auto Weighted' },
  { value: 'manual', label: 'Manual Pin (Exact Ad)' },
  { value: 'rotate', label: 'Rotate Pinned Pool' },
];

function modeHeatmapClass(mode: Exclude<AccessMode, 'inherit'>): string {
  switch (mode) {
    case 'free':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    case 'sub_or_ad':
      return 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30';
    case 'ad_unlock':
      return 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30';
    case 'subscription':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
  }
}

function modeLabel(mode: AccessMode): string {
  switch (mode) {
    case 'inherit':
      return 'Inherit';
    case 'free':
      return 'Free';
    case 'sub_or_ad':
      return 'Sub OR Ad';
    case 'ad_unlock':
      return 'Ad Only';
    case 'subscription':
      return 'Sub Only';
  }
}

export const AdUnlockAdminHub: React.FC<AdUnlockAdminHubProps> = ({
  movies,
  plans,
  customAds,
  vastAds,
  adEvents,
  adSettings,
  adminUid,
  adminName,
  onUpdateMovie,
  onSaveCustomAd,
  onSaveVastAd,
  onSaveAdSettings,
  onSeedCatalog,
  onSeedSampleAds,
  onNotify,
}) => {
  const [section, setSection] = useState<HubSection>('access');
  const [selectedTitleId, setSelectedTitleId] = useState<string>(() => {
    const showcase = movies.find((m) => m.id === 'aether-blade-chronicles');
    return showcase?.id ?? movies[0]?.id ?? '';
  });
  const [titleSearch, setTitleSearch] = useState('');
  const [episodesCache, setEpisodesCache] = useState<Record<string, EpisodeItem[]>>(() => ({
    ...SEED_EPISODES,
  }));
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  // Title-level rule draft
  const selectedMovie = useMemo(
    () => movies.find((m) => m.id === selectedTitleId) ?? movies[0] ?? null,
    [movies, selectedTitleId]
  );

  const [titleRuleDraft, setTitleRuleDraft] = useState<ContentAccessRule>({
    mode: 'free',
    adFormat: 'inherit',
    adSourceMode: 'auto',
    videoAdIds: [],
    bannerAdIds: [],
    adsRequired: 1,
    unlockHours: 24,
  });
  const [savingTitleRule, setSavingTitleRule] = useState(false);

  // Bulk Management state
  const [bulkSeriesId, setBulkSeriesId] = useState<string>(() => {
    const series = movies.filter((m) => m.type === 'series');
    return (
      series.find((s) => s.id === 'aether-blade-chronicles')?.id ?? series[0]?.id ?? ''
    );
  });
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(() => new Set([1, 2]));
  const [selectedEpisodeIds, setSelectedEpisodeIds] = useState<Set<string>>(new Set());
  const [quickRule, setQuickRule] = useState<BulkQuickRuleKind>('first_n_free_rest_sub_or_ad');
  const [quickParamN, setQuickParamN] = useState(1);
  const [quickPlanId, setQuickPlanId] = useState<string>(plans[0]?.id || 'plan-cinema-plus');
  const [quickAdFormat, setQuickAdFormat] = useState<AccessAdFormat>('video');
  const [quickAdSourceMode, setQuickAdSourceMode] = useState<AdSourceMode>('auto');
  const [quickVideoAdIds, setQuickVideoAdIds] = useState<string[]>([]);
  const [quickBannerAdIds, setQuickBannerAdIds] = useState<string[]>([]);
  const [quickAdsRequired, setQuickAdsRequired] = useState(1);
  const [quickUnlockHours, setQuickUnlockHours] = useState(24);
  const [applyingBulk, setApplyingBulk] = useState(false);

  // Creatives modal state
  const [creativeFilter, setCreativeFilter] = useState<'all' | 'banners' | 'videos'>('all');
  const [bannerModalOpen, setBannerModalOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<CustomAdItem | null>(null);
  const [vastModalOpen, setVastModalOpen] = useState(false);
  const [editingVast, setEditingVast] = useState<VastAdItem | null>(null);

  // Global Settings & Badge Customizer draft
  const [settingsDraft, setSettingsDraft] = useState<AdGlobalSettings>(() =>
    normalizeAdSettings(adSettings)
  );
  const [savingSettings, setSavingSettings] = useState(false);

  // Simulator state
  const [simRole, setSimRole] = useState<'guest' | 'free_user' | 'subscriber'>('free_user');
  const [simMovieId, setSimMovieId] = useState<string>(
    () => movies.find((m) => m.id === 'aether-blade-chronicles')?.id ?? movies[0]?.id ?? ''
  );
  const [simEpisodeId, setSimEpisodeId] = useState<string>('');
  const [simMobile, setSimMobile] = useState(false);
  const [simFailures, setSimFailures] = useState(0);
  const [simBannerTestAd, setSimBannerTestAd] = useState<CustomAdItem | null>(null);
  const [simVastTestAd, setSimVastTestAd] = useState<VastAdItem | null>(null);
  const [simUnlockedIds, setSimUnlockedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSettingsDraft(normalizeAdSettings(adSettings));
  }, [adSettings]);

  useEffect(() => {
    if (!selectedTitleId && movies[0]?.id) {
      setSelectedTitleId(movies[0].id);
    }
  }, [movies, selectedTitleId]);

  useEffect(() => {
    if (!selectedMovie) return;
    setTitleRuleDraft({
      mode:
        selectedMovie.access?.mode && selectedMovie.access.mode !== 'inherit'
          ? selectedMovie.access.mode
          : selectedMovie.requiredPlanId || selectedMovie.isPremium
          ? 'subscription'
          : 'free',
      requiredPlanId: selectedMovie.access?.requiredPlanId ?? selectedMovie.requiredPlanId ?? null,
      requiredPlanName:
        selectedMovie.access?.requiredPlanName ?? selectedMovie.requiredPlanName ?? null,
      adFormat: selectedMovie.access?.adFormat ?? selectedMovie.defaultAdFormat ?? 'inherit',
      adSourceMode: selectedMovie.access?.adSourceMode ?? 'auto',
      videoAdIds: selectedMovie.access?.videoAdIds ?? [],
      bannerAdIds: selectedMovie.access?.bannerAdIds ?? [],
      adsRequired: selectedMovie.access?.adsRequired ?? 1,
      unlockHours:
        selectedMovie.access?.unlockHours ?? settingsDraft.defaultUnlockValidityHours ?? 24,
    });

    if (selectedMovie.type === 'series') {
      setLoadingEpisodes(true);
      fetchSeriesEpisodes(selectedMovie.id)
        .then((eps) => {
          if (eps.length > 0) {
            setEpisodesCache((prev) => ({ ...prev, [selectedMovie.id]: eps }));
          }
        })
        .finally(() => setLoadingEpisodes(false));
    }
  }, [selectedMovie?.id]);

  useEffect(() => {
    const targetSeriesId = section === 'bulk' ? bulkSeriesId : simMovieId;
    const targetMovie = movies.find((m) => m.id === targetSeriesId);
    if (!targetMovie || targetMovie.type !== 'series') return;
    fetchSeriesEpisodes(targetMovie.id).then((eps) => {
      if (eps.length > 0) {
        setEpisodesCache((prev) => ({ ...prev, [targetMovie.id]: eps }));
      }
    });
  }, [section, bulkSeriesId, simMovieId, movies]);

  const seriesMovies = useMemo(() => movies.filter((m) => m.type === 'series'), [movies]);
  const unlockVideoAds = useMemo(
    () => vastAds.filter((v) => v.type !== 'overlay'),
    [vastAds]
  );
  const unlockBannerAds = useMemo(
    () => customAds.filter((c) => c.isMandatoryClickBanner || c.placement === 'player'),
    [customAds]
  );

  const selectedSeriesEpisodes = useMemo(() => {
    if (!selectedMovie || selectedMovie.type !== 'series') return [];
    return (episodesCache[selectedMovie.id] ?? []).sort(
      (a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number
    );
  }, [selectedMovie, episodesCache]);

  const selectedSeasons = useMemo(() => {
    const nums = Array.from(new Set(selectedSeriesEpisodes.map((e) => e.seasonNumber))).sort(
      (a, b) => a - b
    );
    return nums.length > 0 ? nums : [1];
  }, [selectedSeriesEpisodes]);

  const allEpisodeOptions: EpisodeOption[] = useMemo(() => {
    const out: EpisodeOption[] = [];
    Object.values(episodesCache).forEach((eps) => {
      eps.forEach((ep) => {
        const m = movies.find((mv) => mv.id === ep.seriesId);
        out.push({
          id: ep.id,
          seriesId: ep.seriesId,
          label: `${m?.title || ep.seriesId} · S${ep.seasonNumber}E${ep.number}: ${ep.title}`,
        });
      });
    });
    return out;
  }, [episodesCache, movies]);

  // Bulk helpers
  const bulkMovie = useMemo(
    () => seriesMovies.find((s) => s.id === bulkSeriesId) ?? seriesMovies[0] ?? null,
    [seriesMovies, bulkSeriesId]
  );
  const bulkEpisodes = useMemo(
    () =>
      bulkMovie
        ? (episodesCache[bulkMovie.id] ?? []).sort(
            (a, b) => a.seasonNumber - b.seasonNumber || a.number - b.number
          )
        : [],
    [bulkMovie, episodesCache]
  );
  const bulkSeasons = useMemo(
    () => Array.from(new Set(bulkEpisodes.map((e) => e.seasonNumber))).sort((a, b) => a - b),
    [bulkEpisodes]
  );
  const bulkPlanObj = plans.find((p) => p.id === quickPlanId) ?? plans[0] ?? null;

  const bulkDiffRows = useMemo(() => {
    if (!bulkMovie || bulkEpisodes.length === 0) return [];
    return applyBulkQuickRulePreview({
      movie: bulkMovie,
      episodes: bulkEpisodes,
      targetEpisodeIds: selectedEpisodeIds.size > 0 ? selectedEpisodeIds : undefined,
      ruleKind: quickRule,
      paramN: quickParamN,
      planId: bulkPlanObj?.id ?? null,
      planName: bulkPlanObj?.name ?? 'Cinema Plus',
      adFormat: quickAdFormat,
      adSourceMode: quickAdSourceMode,
      videoAdIds: quickVideoAdIds,
      bannerAdIds: quickBannerAdIds,
      adsRequired: quickAdsRequired,
      unlockHours: quickUnlockHours,
      settings: settingsDraft,
    });
  }, [
    bulkMovie,
    bulkEpisodes,
    selectedEpisodeIds,
    quickRule,
    quickParamN,
    bulkPlanObj,
    quickAdFormat,
    quickAdSourceMode,
    quickVideoAdIds,
    quickBannerAdIds,
    quickAdsRequired,
    quickUnlockHours,
    settingsDraft,
  ]);

  const handleSaveTitleRule = async () => {
    if (!selectedMovie) return;
    setSavingTitleRule(true);
    try {
      const plan = titleRuleDraft.requiredPlanId
        ? plans.find((p) => p.id === titleRuleDraft.requiredPlanId)
        : null;
      const normalizedRule: ContentAccessRule = {
        ...titleRuleDraft,
        requiredPlanId:
          titleRuleDraft.mode === 'free' || titleRuleDraft.mode === 'ad_unlock'
            ? null
            : plan?.id ?? titleRuleDraft.requiredPlanId ?? plans[0]?.id ?? null,
        requiredPlanName:
          titleRuleDraft.mode === 'free' || titleRuleDraft.mode === 'ad_unlock'
            ? null
            : plan?.name ?? titleRuleDraft.requiredPlanName ?? plans[0]?.name ?? 'Cinema Plus',
        updatedAt: new Date().toISOString(),
      };
      const updatedMovie: MovieItem = {
        ...selectedMovie,
        access: normalizedRule,
        defaultAdFormat: normalizedRule.adFormat ?? selectedMovie.defaultAdFormat ?? 'inherit',
        requiredPlanId: normalizedRule.requiredPlanId ?? null,
        requiredPlanName: normalizedRule.requiredPlanName ?? null,
        isPremium:
          normalizedRule.mode === 'subscription' || normalizedRule.mode === 'sub_or_ad',
        updatedAt: new Date().toISOString(),
      };
      await saveMovieDoc(updatedMovie, adminUid, false);
      onUpdateMovie(updatedMovie);
      onNotify(`Saved access policy for "${selectedMovie.title}"`, 'success');
    } finally {
      setSavingTitleRule(false);
    }
  };

  const handleSaveSeasonRule = async (seasonNum: number, nextMode: AccessMode, nextFormat: AccessAdFormat) => {
    if (!selectedMovie) return;
    const seasonKey = `season-${seasonNum}`;
    const nextSeasonAccess = { ...(selectedMovie.seasonAccess || {}) };
    if (nextMode === 'inherit' && nextFormat === 'inherit') {
      delete nextSeasonAccess[seasonKey];
    } else {
      nextSeasonAccess[seasonKey] = {
        mode: nextMode,
        adFormat: nextFormat,
        requiredPlanId:
          nextMode === 'subscription' || nextMode === 'sub_or_ad'
            ? selectedMovie.requiredPlanId || plans[0]?.id || 'plan-cinema-plus'
            : null,
        requiredPlanName:
          nextMode === 'subscription' || nextMode === 'sub_or_ad'
            ? selectedMovie.requiredPlanName || plans[0]?.name || 'Cinema Plus'
            : null,
        updatedAt: new Date().toISOString(),
      };
    }
    const updatedMovie: MovieItem = {
      ...selectedMovie,
      seasonAccess: nextSeasonAccess,
      updatedAt: new Date().toISOString(),
    };
    await saveMovieDoc(updatedMovie, adminUid, false);
    onUpdateMovie(updatedMovie);
    onNotify(`Updated Season ${seasonNum} override`, 'success');
  };

  const handleUpdateEpisodeRule = async (ep: EpisodeItem, patch: Partial<ContentAccessRule>) => {
    const merged: ContentAccessRule = {
      mode: ep.access?.mode ?? 'inherit',
      adFormat: ep.access?.adFormat ?? 'inherit',
      adSourceMode: ep.access?.adSourceMode ?? 'auto',
      videoAdIds: ep.access?.videoAdIds ?? [],
      bannerAdIds: ep.access?.bannerAdIds ?? [],
      adsRequired: ep.access?.adsRequired ?? 1,
      unlockHours: ep.access?.unlockHours ?? settingsDraft.defaultUnlockValidityHours ?? 24,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const updatedEp: EpisodeItem = { ...ep, access: merged };
    setEpisodesCache((prev) => ({
      ...prev,
      [ep.seriesId]: (prev[ep.seriesId] ?? []).map((x) => (x.id === ep.id ? updatedEp : x)),
    }));
    await saveEpisodeDoc(updatedEp, adminUid);
    onNotify(`Saved S${ep.seasonNumber}E${ep.number} access policy`, 'success');
  };

  const handleApplyBulkBatch = async () => {
    if (!bulkMovie || bulkDiffRows.length === 0) return;
    const changedRows = bulkDiffRows.filter((r) => r.changed);
    const targetRows = changedRows.length > 0 ? changedRows : bulkDiffRows;
    setApplyingBulk(true);
    try {
      const updatedCount = await saveBulkAccessUpdates({
        episodeUpdates: targetRows.map((row) => ({
          seriesId: row.seriesId,
          seasonId: row.seasonId,
          episodeId: row.episodeId,
          access: row.afterRule,
        })),
        adminUid,
        auditSummary: `Bulk updated ${targetRows.length} episodes in "${bulkMovie.title}" (${quickRule})`,
      });
      const updatedMap = new Map(targetRows.map((r) => [r.episodeId, r.afterRule]));
      setEpisodesCache((prev) => ({
        ...prev,
        [bulkMovie.id]: (prev[bulkMovie.id] ?? []).map((ep) =>
          updatedMap.has(ep.id) ? { ...ep, access: updatedMap.get(ep.id) } : ep
        ),
      }));
      onNotify(`Applied access rule to ${updatedCount} episodes`, 'success');
    } finally {
      setApplyingBulk(false);
    }
  };

  const filteredTitles = useMemo(() => {
    const q = titleSearch.trim().toLowerCase();
    return movies.filter((m) => !q || m.title.toLowerCase().includes(q));
  }, [movies, titleSearch]);

  // Simulator derived objects
  const simMovie = useMemo(
    () => movies.find((m) => m.id === simMovieId) ?? movies[0] ?? null,
    [movies, simMovieId]
  );
  const simEpisodes = useMemo(
    () => (simMovie?.type === 'series' ? episodesCache[simMovie.id] ?? [] : []),
    [simMovie, episodesCache]
  );
  const simEpisode = useMemo(
    () => simEpisodes.find((e) => e.id === simEpisodeId) ?? simEpisodes[0] ?? null,
    [simEpisodes, simEpisodeId]
  );
  const simUser: UserProfile | null = useMemo(() => {
    if (simRole === 'guest') return null;
    if (simRole === 'subscriber') {
      return {
        uid: 'sim-sub',
        displayName: 'Demo Cinema Plus Member',
        email: 'subscriber@example.com',
        photoURL: '',
        role: 'user',
        status: 'active',
        plan: 'premium',
        subscriptionPlanId: plans[0]?.id || 'plan-cinema-plus',
        subscriptionPlanName: plans[0]?.name || 'Cinema Plus',
        planExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
    }
    return {
      uid: 'sim-free',
      displayName: 'Demo Free Member',
      email: 'member@example.com',
      photoURL: '',
      role: 'user',
      status: 'active',
      plan: 'free',
      subscriptionPlanId: null,
      subscriptionPlanName: null,
      planExpiresAt: null,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
  }, [simRole, plans]);

  const simUnlocksMap = useMemo(() => {
    const map: Record<string, any> = {};
    simUnlockedIds.forEach((cid) => {
      map[cid] = {
        contentId: cid,
        contentType: 'episode',
        uid: simUser?.uid || 'guest',
        unlockedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        sessionOnly: false,
        adId: 'sim-ad',
        adKind: 'vast',
        format: 'video',
        method: 'rewarded_ad',
      };
    });
    return map;
  }, [simUnlockedIds, simUser?.uid]);

  const simAccess = useMemo(() => {
    if (!simMovie) return null;
    return canWatch({
      movie: simMovie,
      episode: simEpisode,
      user: simUser,
      plans,
      unlocksMap: simUnlocksMap,
      settings: settingsDraft,
    });
  }, [simMovie, simEpisode, simUser, plans, simUnlocksMap, settingsDraft]);

  // Funnel summary
  const mergedEvents = useMemo(() => {
    const local = readLocalFunnelEvents();
    const seen = new Set(adEvents.map((e) => e.id));
    return [...adEvents, ...local.filter((e) => !seen.has(e.id))];
  }, [adEvents]);
  const funnelSummary = useMemo(
    () => buildUnlockFunnelSummary(mergedEvents, customAds, vastAds),
    [mergedEvents, customAds, vastAds]
  );

  const updateBadgeField = (
    key: keyof Pick<
      BadgeCustomizationSettings,
      'paid' | 'freeWithAds' | 'free' | 'included' | 'someEpisodesFree'
    >,
    patch: Partial<BadgeStyleConfig>
  ) => {
    setSettingsDraft((prev) => {
      const currentBadges = normalizeAdSettings(prev).badgeSettings!;
      return {
        ...prev,
        badgeSettings: {
          ...currentBadges,
          [key]: { ...currentBadges[key], ...patch },
        },
      };
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Sub-Navigation & Showcase Seed Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
        <div>
          <h2 className="font-display text-lg font-bold">Ad Unlock, Inheritance &amp; Badges</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Configure per-episode video or mandatory-click banner ads, hierarchy rules, synced badges, and live gate previews.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onSeedCatalog()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Database className="h-3.5 w-3.5" />
            Sync Showcase Catalog
          </button>
          <button
            type="button"
            onClick={() => void onSeedSampleAds()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Sync Rewarded Ads
          </button>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-200 bg-white p-1.5 dark:border-zinc-800 dark:bg-[#13131c]">
        {(
          [
            { id: 'access', label: 'Access Management', icon: <Lock className="h-3.5 w-3.5" /> },
            { id: 'bulk', label: 'Bulk Management', icon: <Layers className="h-3.5 w-3.5" /> },
            { id: 'creatives', label: 'Ad Creatives', icon: <ImageIcon className="h-3.5 w-3.5" /> },
            { id: 'settings', label: 'Settings & Badges', icon: <Settings2 className="h-3.5 w-3.5" /> },
            { id: 'simulator', label: 'Live Simulator', icon: <Eye className="h-3.5 w-3.5" /> },
            { id: 'reports', label: 'Unlock Funnel', icon: <BarChart3 className="h-3.5 w-3.5" /> },
          ] as Array<{ id: HubSection; label: string; icon: React.ReactNode }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              section === tab.id
                ? 'bg-[var(--kv-accent,#e50914)] text-white'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. ACCESS MANAGEMENT */}
      {section === 'access' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Title Picker */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
            <h3 className="mb-3 font-display text-sm font-semibold">Select Movie or Series</h3>
            <input
              type="search"
              value={titleSearch}
              onChange={(e) => setTitleSearch(e.target.value)}
              placeholder="Search catalog..."
              className="mb-3 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
            />
            <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
              {filteredTitles.map((m) => {
                const eff = resolveEffectiveAccessRule(m, null, settingsDraft);
                const active = m.id === selectedMovie?.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedTitleId(m.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${
                      active
                        ? 'border-[var(--kv-accent,#e50914)] bg-[var(--kv-accent,#e50914)]/10'
                        : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{m.title}</p>
                      <p className="text-[10px] text-zinc-500 capitalize">
                        {m.type} · {m.releaseYear}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${modeHeatmapClass(
                        eff.mode
                      )}`}
                    >
                      {modeLabel(eff.mode)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Title + Season + Episode Rules */}
          {selectedMovie && (
            <div className="space-y-6 lg:col-span-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold">{selectedMovie.title}</h3>
                    <p className="text-xs text-zinc-500">
                      Title-level default policy (inherited by seasons &amp; episodes unless overridden)
                    </p>
                  </div>
                  <AccessBadges
                    movie={selectedMovie}
                    episodesSummary={
                      selectedMovie.type === 'series' && selectedSeriesEpisodes.length > 0
                        ? deriveSeriesAccessSummary(selectedMovie, selectedSeriesEpisodes, settingsDraft)
                        : undefined
                    }
                    user={null}
                    plans={plans}
                    adSettings={settingsDraft}
                    size="md"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500">Access Mode</label>
                    <select
                      value={titleRuleDraft.mode}
                      onChange={(e) =>
                        setTitleRuleDraft((d) => ({ ...d, mode: e.target.value as AccessMode }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {ACCESS_MODE_OPTIONS.filter((o) => o.value !== 'inherit').map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500">Required Plan</label>
                    <select
                      value={titleRuleDraft.requiredPlanId ?? ''}
                      disabled={titleRuleDraft.mode === 'free' || titleRuleDraft.mode === 'ad_unlock'}
                      onChange={(e) => {
                        const pid = e.target.value || null;
                        const found = plans.find((p) => p.id === pid);
                        setTitleRuleDraft((d) => ({
                          ...d,
                          requiredPlanId: pid,
                          requiredPlanName: found?.name ?? null,
                        }));
                      }}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">Default Active Plan ({plans[0]?.name || 'Cinema Plus'})</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500">Ad Format</label>
                    <select
                      value={titleRuleDraft.adFormat ?? 'inherit'}
                      onChange={(e) =>
                        setTitleRuleDraft((d) => ({
                          ...d,
                          adFormat: e.target.value as AccessAdFormat,
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {AD_FORMAT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500">Ad Selection Mode</label>
                    <select
                      value={titleRuleDraft.adSourceMode ?? 'auto'}
                      onChange={(e) =>
                        setTitleRuleDraft((d) => ({
                          ...d,
                          adSourceMode: e.target.value as AdSourceMode,
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {AD_SOURCE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500">Ads Required (1–3)</label>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={titleRuleDraft.adsRequired ?? 1}
                      onChange={(e) =>
                        setTitleRuleDraft((d) => ({ ...d, adsRequired: Number(e.target.value) }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-500">
                      Unlock Validity (hours, 0=session)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={168}
                      value={titleRuleDraft.unlockHours ?? 24}
                      onChange={(e) =>
                        setTitleRuleDraft((d) => ({ ...d, unlockHours: Number(e.target.value) }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                    />
                  </div>
                </div>

                {/* Manual / Rotate Specific Ad Pinning */}
                {(titleRuleDraft.adSourceMode === 'manual' ||
                  titleRuleDraft.adSourceMode === 'rotate') && (
                  <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-semibold">Pinned VAST Video Ads</p>
                      <div className="max-h-28 space-y-1 overflow-y-auto">
                        {unlockVideoAds.map((vad) => (
                          <label key={vad.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={(titleRuleDraft.videoAdIds ?? []).includes(vad.id)}
                              onChange={(e) => {
                                const cur = titleRuleDraft.videoAdIds ?? [];
                                setTitleRuleDraft((d) => ({
                                  ...d,
                                  videoAdIds: e.target.checked
                                    ? [...cur, vad.id]
                                    : cur.filter((id) => id !== vad.id),
                                }));
                              }}
                              className="accent-purple-600"
                            />
                            <span className="truncate">{vad.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-semibold">Pinned Mandatory Banner Ads</p>
                      <div className="max-h-28 space-y-1 overflow-y-auto">
                        {unlockBannerAds.map((cad) => (
                          <label key={cad.id} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={(titleRuleDraft.bannerAdIds ?? []).includes(cad.id)}
                              onChange={(e) => {
                                const cur = titleRuleDraft.bannerAdIds ?? [];
                                setTitleRuleDraft((d) => ({
                                  ...d,
                                  bannerAdIds: e.target.checked
                                    ? [...cur, cad.id]
                                    : cur.filter((id) => id !== cad.id),
                                }));
                              }}
                              className="accent-purple-600"
                            />
                            <span className="truncate">{cad.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={savingTitleRule}
                    onClick={() => void handleSaveTitleRule()}
                    className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {savingTitleRule ? 'Saving...' : 'Save Title Access Rule'}
                  </button>
                </div>
              </div>

              {/* Season Overrides & Episode-Level Table */}
              {selectedMovie.type === 'series' && (
                <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
                  <h3 className="font-display text-sm font-bold">
                    Season Overrides &amp; Per-Episode Policies
                  </h3>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedSeasons.map((sNum) => {
                      const sRule = selectedMovie.seasonAccess?.[`season-${sNum}`];
                      return (
                        <div
                          key={sNum}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
                        >
                          <span className="font-semibold">Season {sNum}</span>
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Season ${sNum} mode`}
                              value={sRule?.mode ?? 'inherit'}
                              onChange={(e) =>
                                void handleSaveSeasonRule(
                                  sNum,
                                  e.target.value as AccessMode,
                                  sRule?.adFormat ?? 'inherit'
                                )
                              }
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {ACCESS_MODE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <select
                              aria-label={`Season ${sNum} ad format`}
                              value={sRule?.adFormat ?? 'inherit'}
                              onChange={(e) =>
                                void handleSaveSeasonRule(
                                  sNum,
                                  sRule?.mode ?? 'inherit',
                                  e.target.value as AccessAdFormat
                                )
                              }
                              className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              {AD_FORMAT_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {loadingEpisodes ? (
                    <p className="text-xs text-zinc-500">Loading series episodes...</p>
                  ) : selectedSeriesEpisodes.length === 0 ? (
                    <p className="text-xs text-zinc-500">No episodes found for this series yet.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
                          <tr>
                            <th className="p-2.5">Episode</th>
                            <th className="p-2.5">Effective</th>
                            <th className="p-2.5">Mode Override</th>
                            <th className="p-2.5">Ad Format</th>
                            <th className="p-2.5">Pinned Ad / Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                          {selectedSeriesEpisodes.map((ep) => {
                            const eff = resolveEffectiveAccessRule(selectedMovie, ep, settingsDraft);
                            return (
                              <tr key={ep.id}>
                                <td className="p-2.5">
                                  <p className="font-semibold">
                                    S{ep.seasonNumber}E{ep.number} · {ep.title}
                                  </p>
                                  <p className="text-[10px] text-zinc-500">
                                    Inherited from: {eff.sourceLayer}
                                  </p>
                                </td>
                                <td className="p-2.5">
                                  <span
                                    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${modeHeatmapClass(
                                      eff.mode
                                    )}`}
                                  >
                                    {modeLabel(eff.mode)} · {eff.adFormat}
                                  </span>
                                </td>
                                <td className="p-2.5">
                                  <select
                                    aria-label={`Episode ${ep.id} access mode`}
                                    value={ep.access?.mode ?? 'inherit'}
                                    onChange={(e) =>
                                      void handleUpdateEpisodeRule(ep, {
                                        mode: e.target.value as AccessMode,
                                      })
                                    }
                                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                                  >
                                    {ACCESS_MODE_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-2.5">
                                  <select
                                    aria-label={`Episode ${ep.id} ad format`}
                                    value={ep.access?.adFormat ?? 'inherit'}
                                    onChange={(e) =>
                                      void handleUpdateEpisodeRule(ep, {
                                        adFormat: e.target.value as AccessAdFormat,
                                      })
                                    }
                                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                                  >
                                    {AD_FORMAT_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-2.5">
                                  <select
                                    aria-label={`Episode ${ep.id} pinned ad`}
                                    value={
                                      ep.access?.adSourceMode === 'manual'
                                        ? ep.access?.bannerAdIds?.[0]
                                          ? `banner:${ep.access.bannerAdIds[0]}`
                                          : ep.access?.videoAdIds?.[0]
                                          ? `video:${ep.access.videoAdIds[0]}`
                                          : 'auto'
                                        : 'auto'
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'auto') {
                                        void handleUpdateEpisodeRule(ep, {
                                          adSourceMode: 'auto',
                                          videoAdIds: [],
                                          bannerAdIds: [],
                                        });
                                      } else if (val.startsWith('banner:')) {
                                        const adId = val.replace('banner:', '');
                                        void handleUpdateEpisodeRule(ep, {
                                          adFormat: 'banner',
                                          adSourceMode: 'manual',
                                          bannerAdIds: [adId],
                                          videoAdIds: [],
                                        });
                                      } else if (val.startsWith('video:')) {
                                        const adId = val.replace('video:', '');
                                        void handleUpdateEpisodeRule(ep, {
                                          adFormat: 'video',
                                          adSourceMode: 'manual',
                                          videoAdIds: [adId],
                                          bannerAdIds: [],
                                        });
                                      }
                                    }}
                                    className="max-w-[190px] rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
                                  >
                                    <option value="auto">Auto Weighted Pool</option>
                                    {unlockVideoAds.map((vad) => (
                                      <option key={vad.id} value={`video:${vad.id}`}>
                                        Video: {vad.name}
                                      </option>
                                    ))}
                                    {unlockBannerAds.map((cad) => (
                                      <option key={cad.id} value={`banner:${cad.id}`}>
                                        Banner: {cad.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 2. BULK MANAGEMENT */}
      {section === 'bulk' && (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Expandable Series -> Season -> Episode Heatmap Tree */}
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c] lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold">Series Tree &amp; Heatmap</h3>
              <button
                type="button"
                onClick={() => setSelectedEpisodeIds(new Set())}
                className="text-[11px] text-zinc-500 hover:underline"
              >
                Target All ({bulkEpisodes.length})
              </button>
            </div>
            <select
              aria-label="Bulk management target series"
              value={bulkSeriesId}
              onChange={(e) => {
                setBulkSeriesId(e.target.value);
                setSelectedEpisodeIds(new Set());
              }}
              className="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {seriesMovies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>

            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {bulkSeasons.map((sNum) => {
                const sEps = bulkEpisodes.filter((e) => e.seasonNumber === sNum);
                const expanded = expandedSeasons.has(sNum);
                const allSelected = sEps.length > 0 && sEps.every((e) => selectedEpisodeIds.has(e.id));
                return (
                  <div
                    key={sNum}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800"
                  >
                    <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 dark:bg-zinc-900/60">
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(expandedSeasons);
                          if (expanded) next.delete(sNum);
                          else next.add(sNum);
                          setExpandedSeasons(next);
                        }}
                        className="flex items-center gap-1.5 text-xs font-semibold"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        Season {sNum} ({sEps.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(selectedEpisodeIds);
                          if (allSelected) sEps.forEach((e) => next.delete(e.id));
                          else sEps.forEach((e) => next.add(e.id));
                          setSelectedEpisodeIds(next);
                        }}
                        className="text-[11px] font-medium text-[var(--kv-accent,#e50914)] hover:underline"
                      >
                        {allSelected ? 'Uncheck Season' : 'Select Season'}
                      </button>
                    </div>
                    {expanded && (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                        {sEps.map((ep) => {
                          const eff = bulkMovie
                            ? resolveEffectiveAccessRule(bulkMovie, ep, settingsDraft)
                            : null;
                          return (
                            <label
                              key={ep.id}
                              className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={selectedEpisodeIds.has(ep.id)}
                                  onChange={(e) => {
                                    const next = new Set(selectedEpisodeIds);
                                    if (e.target.checked) next.add(ep.id);
                                    else next.delete(ep.id);
                                    setSelectedEpisodeIds(next);
                                  }}
                                  className="accent-purple-600"
                                />
                                <span className="truncate">
                                  E{ep.number} · {ep.title}
                                </span>
                              </span>
                              {eff && (
                                <span
                                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${modeHeatmapClass(
                                    eff.mode
                                  )}`}
                                >
                                  {modeLabel(eff.mode)}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Quick Rule Config + Diff Preview + Batch Save */}
          <div className="space-y-4 lg:col-span-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
              <h3 className="mb-3 font-display text-sm font-bold">Quick Rule Builder</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-zinc-500">Rule Template</label>
                  <select
                    value={quickRule}
                    onChange={(e) => setQuickRule(e.target.value as BulkQuickRuleKind)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="first_n_free_rest_sub_or_ad">First N Free · Rest Sub OR Ad</option>
                    <option value="first_n_free_rest_sub_only">First N Free · Rest Sub Only</option>
                    <option value="all_sub_or_ad">All Selected Sub OR Ad</option>
                    <option value="all_ad_only">All Selected Watch Ad Only</option>
                    <option value="all_sub_only">All Selected Sub Only</option>
                    <option value="every_nth_free">Every Nth Free · Rest Sub OR Ad</option>
                    <option value="all_free">All Selected Free</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">N (Episode Count)</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={quickParamN}
                    onChange={(e) => setQuickParamN(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">Subscription Plan</label>
                  <select
                    value={quickPlanId}
                    onChange={(e) => setQuickPlanId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">Unlock Ad Format</label>
                  <select
                    value={quickAdFormat}
                    onChange={(e) => setQuickAdFormat(e.target.value as AccessAdFormat)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {AD_FORMAT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">Ad Selection</label>
                  <select
                    value={quickAdSourceMode}
                    onChange={(e) => setQuickAdSourceMode(e.target.value as AdSourceMode)}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {AD_SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">Ads Required</label>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={quickAdsRequired}
                    onChange={(e) => setQuickAdsRequired(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-500">Validity (hours)</label>
                  <input
                    type="number"
                    min={0}
                    max={168}
                    value={quickUnlockHours}
                    onChange={(e) => setQuickUnlockHours(Number(e.target.value))}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                  />
                </div>
              </div>

              {(quickAdSourceMode === 'manual' || quickAdSourceMode === 'rotate') && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-zinc-500">Pin Video Ads</p>
                    <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-zinc-800">
                      {unlockVideoAds.map((vad) => (
                        <label key={vad.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={quickVideoAdIds.includes(vad.id)}
                            onChange={(e) =>
                              setQuickVideoAdIds((cur) =>
                                e.target.checked
                                  ? [...cur, vad.id]
                                  : cur.filter((id) => id !== vad.id)
                              )
                            }
                            className="accent-purple-600"
                          />
                          <span className="truncate">{vad.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-zinc-500">Pin Banner Ads</p>
                    <div className="max-h-24 space-y-1 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-zinc-800">
                      {unlockBannerAds.map((cad) => (
                        <label key={cad.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={quickBannerAdIds.includes(cad.id)}
                            onChange={(e) =>
                              setQuickBannerAdIds((cur) =>
                                e.target.checked
                                  ? [...cur, cad.id]
                                  : cur.filter((id) => id !== cad.id)
                              )
                            }
                            className="accent-purple-600"
                          />
                          <span className="truncate">{cad.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Live Preview Diff */}
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold">
                    Preview Diff ({bulkDiffRows.filter((r) => r.changed).length} changing of{' '}
                    {bulkDiffRows.length})
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    Writes execute in chunked Firestore batches (&lt;= 400 operations per commit).
                  </p>
                </div>
                <button
                  type="button"
                  disabled={applyingBulk || bulkDiffRows.length === 0}
                  onClick={() => void handleApplyBulkBatch()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <Zap className="h-3.5 w-3.5" />
                  {applyingBulk ? 'Saving Batch...' : 'Apply & Save Batch'}
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <tr>
                      <th className="p-2">Episode</th>
                      <th className="p-2">Before</th>
                      <th className="p-2">After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {bulkDiffRows.map((row) => (
                      <tr
                        key={row.episodeId}
                        className={row.changed ? 'bg-purple-500/5' : 'opacity-65'}
                      >
                        <td className="p-2 font-medium">
                          S{row.seasonNumber}E{row.episodeNumber} · {row.episodeTitle}
                        </td>
                        <td className="p-2">{modeLabel(row.beforeMode)}</td>
                        <td className="p-2 font-semibold">
                          {modeLabel(row.afterRule.mode)}
                          {row.afterRule.adFormat && row.afterRule.adFormat !== 'inherit'
                            ? ` (${row.afterRule.adFormat})`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. AD CREATIVES & ASSIGNMENT */}
      {section === 'creatives' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {(
                [
                  { id: 'all', label: 'All Unlock Creatives' },
                  { id: 'banners', label: `Mandatory Banners (${unlockBannerAds.length})` },
                  { id: 'videos', label: `Rewarded VAST Videos (${unlockVideoAds.length})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCreativeFilter(f.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    creativeFilter === f.id
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950'
                      : 'border border-zinc-300 dark:border-zinc-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingBanner(null);
                  setBannerModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#7c3aed] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#6d28d9]"
              >
                <Plus className="h-3.5 w-3.5" />
                New Mandatory-Click Banner
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingVast(null);
                  setVastModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-3.5 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                New Rewarded Video Ad
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {(creativeFilter === 'all' || creativeFilter === 'banners') &&
              unlockBannerAds.map((cad) => (
                <div
                  key={cad.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]"
                >
                  <div className="flex gap-3">
                    <img
                      src={cad.imageUrl}
                      alt={cad.altText || cad.name}
                      className="h-20 w-32 shrink-0 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold text-purple-600 dark:text-purple-300">
                          Mandatory-Click Banner
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            cad.status === 'active'
                              ? 'bg-emerald-500/15 text-emerald-600'
                              : 'bg-zinc-500/15 text-zinc-500'
                          }`}
                        >
                          {cad.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate font-display text-sm font-bold">{cad.name}</p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {cad.advertiserName || cad.redirectUrl} · {cad.requiredViewSeconds ?? 30}s post-click
                      </p>
                      <p className="mt-1 font-mono-tabular text-[11px] text-zinc-500">
                        {cad.impressions} impr · {cad.clicks} clicks · {cad.completions ?? 0} completed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBanner(cad);
                        setBannerModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
                    >
                      <Edit3 className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void onSaveCustomAd(
                          {
                            ...cad,
                            status: cad.status === 'active' ? 'inactive' : 'active',
                            updatedAt: new Date().toISOString(),
                          },
                          false
                        )
                      }
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
                    >
                      {cad.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}

            {(creativeFilter === 'all' || creativeFilter === 'videos') &&
              unlockVideoAds.map((vad) => (
                <div
                  key={vad.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                        VAST {vad.type}
                      </span>
                      {vad.isUnlockEligible && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                          Unlock Eligible
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-display text-sm font-bold">{vad.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                      {vad.vastTagUrl}
                    </p>
                    <p className="mt-1 font-mono-tabular text-[11px] text-zinc-500">
                      {vad.unlockDurationSeconds ?? 30}s · {vad.impressions} impr · {vad.completions} comp
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingVast(vad);
                        setVastModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
                    >
                      <Edit3 className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void onSaveVastAd(
                          {
                            ...vad,
                            status: vad.status === 'active' ? 'inactive' : 'active',
                            updatedAt: new Date().toISOString(),
                          },
                          false
                        )
                      }
                      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium dark:border-zinc-700"
                    >
                      {vad.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 4. GLOBAL SETTINGS & BADGE CUSTOMIZER */}
      {section === 'settings' && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Global Rules & Editable Gate Copy */}
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
              <h3 className="font-display text-base font-bold">Ad Unlock Rules &amp; Gate Copy</h3>
              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span>Enable Watch Ad to Unlock</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.adUnlockEnabled)}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, adUnlockEnabled: e.target.checked }))
                    }
                    className="accent-purple-600"
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span>Allow Guest Unlocking</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.guestAdUnlock)}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, guestAdUnlock: e.target.checked }))
                    }
                    className="accent-purple-600"
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span>Allow Video Ad Skip Before Completion</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.unlockSkipAllowed)}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, unlockSkipAllowed: e.target.checked }))
                    }
                    className="accent-purple-600"
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span>Auto-Unlock After Banner Countdown</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.bannerAutoUnlockAfterCountdown)}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        bannerAutoUnlockAfterCountdown: e.target.checked,
                      }))
                    }
                    className="accent-purple-600"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <div>
                  <label className="mb-1 block text-zinc-500">Max Unlocks / Hour</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={settingsDraft.maxUnlocksPerHour ?? 20}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, maxUnlocksPerHour: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-zinc-500">Validity (Hours, 0=Session)</label>
                  <input
                    type="number"
                    min={0}
                    max={168}
                    value={settingsDraft.defaultUnlockValidityHours ?? 24}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        defaultUnlockValidityHours: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-zinc-500">Banner Countdown (sec)</label>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={settingsDraft.bannerCountdownSeconds ?? 30}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        bannerCountdownSeconds: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <div>
                  <label className="mb-1 block text-zinc-500">After 2 Failures Fallback</label>
                  <select
                    value={settingsDraft.failureFallback ?? 'keep_locked'}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        failureFallback: e.target.value as FailureFallbackMode,
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="keep_locked">Keep Locked (Subscription Required)</option>
                    <option value="free_once">Allow One Free Playback</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-zinc-500">Default Ad Format</label>
                  <select
                    value={settingsDraft.defaultUnlockAdFormat ?? 'video'}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        defaultUnlockAdFormat: e.target.value as 'video' | 'banner' | 'auto',
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="video">Video Ad</option>
                    <option value="banner">Mandatory-Click Banner</option>
                    <option value="auto">Auto</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="mb-1 block text-zinc-500">Gate Title</label>
                  <input
                    type="text"
                    value={settingsDraft.gateTitle ?? ''}
                    onChange={(e) => setSettingsDraft((s) => ({ ...s, gateTitle: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-zinc-500">Gate Description</label>
                  <textarea
                    rows={2}
                    value={settingsDraft.gateDescription ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, gateDescription: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-zinc-500">Watch Ad CTA</label>
                    <input
                      type="text"
                      value={settingsDraft.watchAdButtonText ?? ''}
                      onChange={(e) =>
                        setSettingsDraft((s) => ({ ...s, watchAdButtonText: e.target.value }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-zinc-500">Watch Ad Subtext</label>
                    <input
                      type="text"
                      value={settingsDraft.watchAdSubtext ?? ''}
                      onChange={(e) =>
                        setSettingsDraft((s) => ({ ...s, watchAdSubtext: e.target.value }))
                      }
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-zinc-500">Mandatory Banner Prompt</label>
                  <input
                    type="text"
                    value={settingsDraft.bannerPromptText ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, bannerPromptText: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
                  />
                </div>
              </div>
            </div>

            {/* Synchronized Badge Customizer */}
            <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
              <h3 className="font-display text-base font-bold">Synchronized Access Badge Customizer</h3>
              <div className="grid gap-3 sm:grid-cols-2 text-xs">
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span>Show Plan Name on PAID</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.badgeSettings?.showPlanNameOnPaid)}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        badgeSettings: {
                          ...normalizeAdSettings(s).badgeSettings!,
                          showPlanNameOnPaid: e.target.checked,
                        },
                      }))
                    }
                    className="accent-purple-600"
                  />
                </label>
                <label className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <span>Icon-Only Badges on Mobile</span>
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.badgeSettings?.collapseOnMobile)}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        badgeSettings: {
                          ...normalizeAdSettings(s).badgeSettings!,
                          collapseOnMobile: e.target.checked,
                        },
                      }))
                    }
                    className="accent-purple-600"
                  />
                </label>
              </div>

              {(
                [
                  { key: 'paid', title: 'PAID Badge' },
                  { key: 'freeWithAds', title: 'FREE WITH ADS Badge' },
                  { key: 'free', title: 'FREE Badge (OFF by default)' },
                  { key: 'included', title: 'INCLUDED Badge (Subscribers)' },
                  { key: 'someEpisodesFree', title: 'Some Episodes Free (Mixed Series)' },
                ] as const
              ).map((item) => {
                const cfg = settingsDraft.badgeSettings![item.key];
                return (
                  <div
                    key={item.key}
                    className="grid items-center gap-2 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800 sm:grid-cols-12"
                  >
                    <label className="flex items-center gap-2 sm:col-span-4 font-semibold">
                      <input
                        type="checkbox"
                        checked={cfg.enabled}
                        onChange={(e) => updateBadgeField(item.key, { enabled: e.target.checked })}
                        className="accent-purple-600"
                      />
                      <span>{item.title}</span>
                    </label>
                    <input
                      type="text"
                      value={cfg.label}
                      onChange={(e) => updateBadgeField(item.key, { label: e.target.value })}
                      className="sm:col-span-4 rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
                    />
                    <input
                      type="color"
                      value={cfg.color}
                      onChange={(e) => updateBadgeField(item.key, { color: e.target.value })}
                      aria-label={`${item.title} color`}
                      className="sm:col-span-1 h-7 w-full cursor-pointer rounded border border-zinc-300 bg-transparent"
                    />
                    <select
                      value={cfg.icon}
                      onChange={(e) =>
                        updateBadgeField(item.key, { icon: e.target.value as BadgeIconKind })
                      }
                      className="sm:col-span-3 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="lock">Lock</option>
                      <option value="crown">Crown</option>
                      <option value="play">Play</option>
                      <option value="gift">Gift</option>
                      <option value="check">Check</option>
                      <option value="sparkles">Sparkles</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={savingSettings}
              onClick={async () => {
                setSavingSettings(true);
                try {
                  await onSaveAdSettings(settingsDraft);
                } finally {
                  setSavingSettings(false);
                }
              }}
              className="rounded-lg bg-[var(--kv-accent,#e50914)] px-6 py-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingSettings ? 'Saving Settings...' : 'Save Global Settings & Badges'}
            </button>
          </div>
        </div>
      )}

      {/* 5. INTERACTIVE SIMULATOR & LIVE PREVIEW */}
      {section === 'simulator' && simMovie && simAccess && (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c] sm:grid-cols-5">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Viewer Role</label>
              <select
                value={simRole}
                onChange={(e) =>
                  setSimRole(e.target.value as 'guest' | 'free_user' | 'subscriber')
                }
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="guest">Guest (Not Signed In)</option>
                <option value="free_user">Signed-In Free User</option>
                <option value="subscriber">Cinema Plus Subscriber</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Title</label>
              <select
                value={simMovie.id}
                onChange={(e) => {
                  setSimMovieId(e.target.value);
                  setSimEpisodeId('');
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                {movies.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Episode</label>
              <select
                disabled={simEpisodes.length === 0}
                value={simEpisode?.id ?? ''}
                onChange={(e) => setSimEpisodeId(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {simEpisodes.length === 0 ? (
                  <option value="">Standalone Movie</option>
                ) : (
                  simEpisodes.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      S{ep.seasonNumber}E{ep.number} · {ep.title}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Failure Simulation</label>
              <select
                value={simFailures}
                onChange={(e) => setSimFailures(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value={0}>0 Failures (Normal)</option>
                <option value={1}>1 Failure (Retry Prompt)</option>
                <option value={2}>2 Failures (Fallback Active)</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setSimMobile((m) => !m)}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold dark:border-zinc-700"
              >
                {simMobile ? 'Mobile (390px)' : 'Desktop'}
              </button>
              <button
                type="button"
                onClick={() => setSimUnlockedIds(new Set())}
                aria-label="Reset simulator unlocks"
                className="rounded-lg border border-zinc-300 p-2 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-500">Synced Badge Preview:</span>
                <AccessBadges
                  movie={simMovie}
                  episode={simEpisode}
                  episodesSummary={
                    !simEpisode && simEpisodes.length > 0
                      ? deriveSeriesAccessSummary(simMovie, simEpisodes, settingsDraft)
                      : undefined
                  }
                  user={simUser}
                  plans={plans}
                  unlocksMap={simUnlocksMap}
                  adSettings={settingsDraft}
                  isMobile={simMobile}
                  size="md"
                />
              </div>
              <span className="font-mono text-[11px] text-zinc-500">
                Rule: {simAccess.effectiveRule.mode} · Format: {simAccess.effectiveRule.adFormat} ·
                Decision: {simAccess.unlockedBy}
              </span>
            </div>

            {simBannerTestAd ? (
              <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                <MandatoryBannerUnlock
                  ad={simBannerTestAd}
                  adSettings={{ ...settingsDraft, testMode: true }}
                  userId={simUser?.uid}
                  contentId={simAccess.unlockKey}
                  contentType={simMovie.type === 'series' ? 'tvshow' : 'movie'}
                  onComplete={() => {
                    setSimUnlockedIds((prev) => new Set(prev).add(simAccess.unlockKey));
                    setSimBannerTestAd(null);
                    onNotify('Simulator: Mandatory-click banner completed!', 'success');
                  }}
                  onCancel={() => {
                    setSimBannerTestAd(null);
                    onNotify('Simulator: Closed early — episode stayed locked.', 'info');
                  }}
                />
              </div>
            ) : simVastTestAd ? (
              <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                <VastPlayerOverlay
                  ad={simVastTestAd}
                  adSettings={{ ...settingsDraft, testMode: true }}
                  userId={simUser?.uid}
                  contentId={simAccess.unlockKey}
                  contentType={simMovie.type === 'series' ? 'tvshow' : 'movie'}
                  unlockMode
                  allowUnlockSkip={Boolean(settingsDraft.unlockSkipAllowed)}
                  onCancel={() => {
                    setSimVastTestAd(null);
                    onNotify('Simulator: VAST exited early — kept locked.', 'info');
                  }}
                  onFinish={() => {
                    setSimUnlockedIds((prev) => new Set(prev).add(simAccess.unlockKey));
                    setSimVastTestAd(null);
                    onNotify('Simulator: Rewarded video completed!', 'success');
                  }}
                />
              </div>
            ) : simAccess.allowed ? (
              <div className="flex aspect-video flex-col items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="mt-2 font-display text-lg font-bold">
                  Direct Playback Allowed ({simAccess.unlockedBy})
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {simRole === 'subscriber'
                    ? 'Active subscribers bypass all gates and unlock ads.'
                    : 'This episode/title plays immediately with zero gate.'}
                </p>
              </div>
            ) : (
              <WatchGateOverlay
                movie={simMovie}
                episode={simEpisode}
                user={simUser}
                access={simAccess}
                adSettings={settingsDraft}
                adError={simFailures > 0 ? 'Simulated VAST / ad-blocker load error.' : null}
                failureCount={simFailures}
                onBack={() => onNotify('Simulator: Back button clicked', 'info')}
                onStartAdUnlock={() => {
                  const chosen = selectUnlockAd({
                    adFormat: simAccess.effectiveRule.adFormat,
                    adSourceMode: simAccess.effectiveRule.adSourceMode,
                    pinnedVideoAdIds: simAccess.effectiveRule.videoAdIds,
                    pinnedBannerAdIds: simAccess.effectiveRule.bannerAdIds,
                    vastAds: unlockVideoAds,
                    customAds: unlockBannerAds,
                    ctx: {
                      user: simUser,
                      device: simMobile ? 'mobile' : 'desktop',
                      contentType: simMovie.type === 'series' ? 'tvshow' : 'movie',
                      contentId: simMovie.id,
                      episodeId: simEpisode?.id,
                    },
                  });
                  if (!chosen) {
                    onNotify('No active unlock ad available to preview.', 'error');
                    return;
                  }
                  if (chosen.format === 'banner') setSimBannerTestAd(chosen.ad);
                  else setSimVastTestAd(chosen.ad);
                }}
                onRetryAdUnlock={() => setSimFailures(0)}
                onFallbackContinue={() =>
                  setSimUnlockedIds((prev) => new Set(prev).add(simAccess.unlockKey))
                }
                onOpenAuth={() => onNotify('Simulator: Sign In modal requested', 'info')}
                onSubscribeClick={() => onNotify('Simulator: View Cinema Plus Plan clicked', 'info')}
              />
            )}
          </div>
        </div>
      )}

      {/* 6. FUNNEL & FORMAT REPORTS */}
      {section === 'reports' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold">
                Ad Unlock Funnel &amp; Format Performance
              </h3>
              <p className="text-xs text-zinc-500">
                Tracks video completions, mandatory-click banner impressions/clicks/completions, unlocks, and Cinema Plus conversions.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const csv = generateUnlockFunnelCsv(funnelSummary, adminName);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `kinovault-unlock-funnel-${formatReportTimestamp()
                  .slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                onNotify('Downloaded unlock funnel CSV report', 'success');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-zinc-950"
            >
              <Download className="h-3.5 w-3.5" />
              Export Funnel CSV
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: 'Gate Views', val: funnelSummary.gateViews },
              { label: 'Video Completions', val: funnelSummary.videoCompletions },
              { label: 'Banner Clicks', val: funnelSummary.bannerClicks },
              { label: 'Unlocks Granted', val: funnelSummary.unlocksGranted },
              { label: 'Subscribe Conversions', val: funnelSummary.subscribeConversions },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]"
              >
                <p className="text-[11px] text-zinc-500">{k.label}</p>
                <p className="font-mono-tabular mt-1 text-2xl font-bold">{k.val}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#13131c]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="p-3">Ad Format</th>
                  <th className="p-3 text-right">Impressions / Starts</th>
                  <th className="p-3 text-right">Clicks</th>
                  <th className="p-3 text-right">Completed Interactions</th>
                  <th className="p-3 text-right">Completion / CTR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                <tr>
                  <td className="p-3 font-semibold">VAST Video Ads</td>
                  <td className="font-mono-tabular p-3 text-right">{funnelSummary.videoStarts}</td>
                  <td className="font-mono-tabular p-3 text-right">
                    {vastAds.reduce((s, a) => s + (a.clicks || 0), 0)}
                  </td>
                  <td className="font-mono-tabular p-3 text-right">
                    {funnelSummary.videoCompletions}
                  </td>
                  <td className="font-mono-tabular p-3 text-right font-semibold">
                    {funnelSummary.videoCompletionRatePct} comp
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold">Mandatory-Click Banners</td>
                  <td className="font-mono-tabular p-3 text-right">
                    {funnelSummary.bannerImpressions}
                  </td>
                  <td className="font-mono-tabular p-3 text-right">{funnelSummary.bannerClicks}</td>
                  <td className="font-mono-tabular p-3 text-right">
                    {funnelSummary.bannerCompletedInteractions}
                  </td>
                  <td className="font-mono-tabular p-3 text-right font-semibold">
                    {funnelSummary.bannerClickThroughPct} CTR ·{' '}
                    {funnelSummary.bannerCompletionRatePct} post-click
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
            Measurement accuracy note: Banner unlock completions reflect verifiable browser click and countdown-elapsed events (plus optional advertiser postback callbacks when integrated). Websites cannot independently verify whether a user read an external third-party tab after clicking through.
          </p>
        </div>
      )}

      {/* Creatives Modals */}
      <CustomAdFormModal
        open={bannerModalOpen}
        initialAd={editingBanner}
        movies={movies}
        episodes={allEpisodeOptions}
        adminUid={adminUid}
        onClose={() => setBannerModalOpen(false)}
        onSave={onSaveCustomAd}
        onNotify={onNotify}
      />

      <VastAdFormModal
        open={vastModalOpen}
        initialAd={editingVast}
        movies={movies}
        episodes={allEpisodeOptions}
        adminUid={adminUid}
        onClose={() => setVastModalOpen(false)}
        onSave={onSaveVastAd}
      />
    </div>
  );
};
