import type {
  AchievementItem,
  AchievementKind,
  EpisodeItem,
  LibraryActivityItem,
  LibraryItem,
  LibraryStats,
  LibraryStatus,
  MovieItem,
  TitleProgressItem,
  TitleType,
  WatchHistoryItem,
  WatchlistItem,
} from '../types/streaming';

export const EPISODE_COMPLETION_THRESHOLD = 0.9;
export const MAX_COMPLETED_EPISODES = 500;

export function sanitizeLibraryStatus(value: unknown): LibraryStatus {
  if (value === 'completed' || value === 'paused' || value === 'watching') {
    return value;
  }
  return 'watching';
}

export function isEpisodeCompleted(progressSeconds: number, durationSeconds: number): boolean {
  if (!Number.isFinite(progressSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }
  return progressSeconds / durationSeconds >= EPISODE_COMPLETION_THRESHOLD;
}

export function getProgressUnitId(
  movie: Pick<MovieItem, 'id' | 'type'>,
  episode?: Pick<EpisodeItem, 'id'> | null
): string {
  if (movie.type === 'series' && episode?.id) {
    return episode.id;
  }
  return movie.id;
}

export function buildAchievementId(kind: AchievementKind, titleId: string): string {
  return `${kind}_${titleId}`;
}

export interface ComputeProgressParams {
  titleId: string;
  titleType: TitleType;
  totalEpisodesCount: number;
  prevCompletedEpisodeIds?: string[];
  newlyCompletedUnitId: string;
  lastSeasonId?: string | null;
  lastEpisodeId?: string | null;
  updatedAt: string;
}

export interface ComputeProgressResult {
  progress: TitleProgressItem;
  alreadyCompletedUnit: boolean;
  didCompleteTitle: boolean;
}

export function computeTitleProgress({
  titleId,
  titleType,
  totalEpisodesCount,
  prevCompletedEpisodeIds = [],
  newlyCompletedUnitId,
  lastSeasonId = null,
  lastEpisodeId = null,
  updatedAt,
}: ComputeProgressParams): ComputeProgressResult {
  const uniqueIds = Array.from(
    new Set(prevCompletedEpisodeIds.filter((id) => typeof id === 'string' && id.length > 0))
  ).slice(0, MAX_COMPLETED_EPISODES);

  const alreadyCompletedUnit = uniqueIds.includes(newlyCompletedUnitId);
  if (!alreadyCompletedUnit && uniqueIds.length < MAX_COMPLETED_EPISODES) {
    uniqueIds.push(newlyCompletedUnitId);
  }

  const totalUnits =
    titleType === 'movie'
      ? 1
      : Math.min(MAX_COMPLETED_EPISODES, Math.max(1, totalEpisodesCount, uniqueIds.length));

  const completedUnits = Math.min(totalUnits, uniqueIds.length);
  const progressPercent = Math.min(100, Math.round((completedUnits / totalUnits) * 100));

  return {
    progress: {
      titleId,
      totalUnits,
      completedUnits,
      completedEpisodeIds: uniqueIds,
      progressPercent,
      lastSeasonId,
      lastEpisodeId,
      updatedAt,
    },
    alreadyCompletedUnit,
    didCompleteTitle: progressPercent >= 100,
  };
}

export function deriveLibraryStats(params: {
  library: LibraryItem[];
  progressMap: Record<string, TitleProgressItem>;
  activity: LibraryActivityItem[];
  achievements: AchievementItem[];
}): LibraryStats {
  const { library, progressMap, activity, achievements } = params;
  const totalTitles = library.length;

  const completedTitleIds = new Set<string>();
  for (const item of library) {
    if (item.status === 'completed' || (progressMap[item.titleId]?.progressPercent ?? 0) >= 100) {
      completedTitleIds.add(item.titleId);
    }
  }
  for (const [titleId, prog] of Object.entries(progressMap)) {
    if (prog.progressPercent >= 100) {
      completedTitleIds.add(titleId);
    }
  }

  const totalSeconds = activity.reduce((acc, entry) => {
    if (entry.type !== 'watch') return acc;
    const secs = typeof entry.durationSeconds === 'number' && entry.durationSeconds > 0 ? entry.durationSeconds : 0;
    return acc + secs;
  }, 0);

  return {
    totalTitles,
    completedTitles: completedTitleIds.size,
    hoursWatched: Math.round((totalSeconds / 3600) * 10) / 10,
    achievementsCount: achievements.length,
  };
}

export interface GuestMergePlan {
  watchlistToWrite: WatchlistItem[];
  historyToWrite: WatchHistoryItem[];
  libraryToWrite: LibraryItem[];
}

export function planGuestMerge(params: {
  guestWatchlist: WatchlistItem[];
  guestHistory: WatchHistoryItem[];
  existingWatchlistIds: Set<string>;
  existingHistoryMap: Record<string, WatchHistoryItem>;
  existingLibraryIds: Set<string>;
  moviesMap: Record<string, MovieItem>;
  nowIso: string;
}): GuestMergePlan {
  const {
    guestWatchlist,
    guestHistory,
    existingWatchlistIds,
    existingHistoryMap,
    existingLibraryIds,
    moviesMap,
    nowIso,
  } = params;

  const watchlistToWrite: WatchlistItem[] = [];
  const historyToWrite: WatchHistoryItem[] = [];
  const libraryToWrite: LibraryItem[] = [];
  const plannedLibraryIds = new Set(existingLibraryIds);

  for (const item of guestWatchlist) {
    if (!item?.movieId) continue;
    if (!existingWatchlistIds.has(item.movieId)) {
      watchlistToWrite.push({
        movieId: item.movieId,
        addedAt: item.addedAt || nowIso,
      });
    }
    const movie = moviesMap[item.movieId];
    if (movie && !plannedLibraryIds.has(movie.id)) {
      plannedLibraryIds.add(movie.id);
      libraryToWrite.push({
        titleId: movie.id,
        titleName: movie.title,
        titleType: movie.type,
        posterUrl: movie.posterUrl,
        addedAt: item.addedAt || nowIso,
        status: 'watching',
      });
    }
  }

  for (const h of guestHistory) {
    if (!h?.movieId) continue;
    const remote = existingHistoryMap[h.movieId];
    const shouldWriteHistory =
      !remote ||
      (h.updatedAt || '') > (remote.updatedAt || '') ||
      h.progressSeconds > remote.progressSeconds;
    if (shouldWriteHistory) {
      historyToWrite.push(h);
    }
    const movie = moviesMap[h.movieId];
    if (movie && !plannedLibraryIds.has(movie.id)) {
      plannedLibraryIds.add(movie.id);
      const completed = isEpisodeCompleted(h.progressSeconds, h.durationSeconds) && movie.type === 'movie';
      libraryToWrite.push({
        titleId: movie.id,
        titleName: movie.title,
        titleType: movie.type,
        posterUrl: movie.posterUrl,
        addedAt: h.updatedAt || nowIso,
        status: completed ? 'completed' : 'watching',
      });
    }
  }

  return { watchlistToWrite, historyToWrite, libraryToWrite };
}
