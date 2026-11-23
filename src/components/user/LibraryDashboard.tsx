import React, { useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  Award,
  BookMarked,
  CheckCircle2,
  Clock,
  Film,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Trophy,
} from 'lucide-react';
import type {
  AchievementItem,
  LibraryActivityItem,
  LibraryItem,
  LibraryStatus,
  MovieItem,
  TitleProgressItem,
  UserProfile,
} from '../../types/streaming';
import { formatDuration, formatRelativeTime } from '../../utils/catalog';
import { deriveLibraryStats } from '../../utils/library';
import { ConfirmDialog, Modal } from '../ui/Modal';

export type LibraryTabKey = 'library' | 'progress' | 'activity' | 'achievements';

interface LibraryDashboardProps {
  user: UserProfile;
  movies: MovieItem[];
  moviesMap: Record<string, MovieItem>;
  library: LibraryItem[];
  progressMap: Record<string, TitleProgressItem>;
  activity: LibraryActivityItem[];
  activityHasMore: boolean;
  activityLoadingMore: boolean;
  activityTitleFilter: string | null;
  achievements: AchievementItem[];
  ratings: Record<string, number>;
  loading: boolean;
  initialTab?: LibraryTabKey;
  onChangeActivityFilter: (titleId: string | null) => void;
  onLoadMoreActivity: () => Promise<void>;
  onAddToLibrary: (movie: MovieItem, status: LibraryStatus) => Promise<void>;
  onUpdateStatus: (item: LibraryItem, status: LibraryStatus) => Promise<void>;
  onRemoveFromLibrary: (item: LibraryItem) => Promise<void>;
  onRateTitle: (movie: MovieItem, rating: number) => Promise<void>;
  onPlayMovie: (movie: MovieItem) => void;
  onSelectMovie: (movie: MovieItem) => void;
}

const STATUS_BADGE_MAP: Record<LibraryStatus, { label: string; className: string }> = {
  watching: {
    label: 'Watching',
    className:
      'bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300 dark:border-sky-400/30',
  },
  completed: {
    label: 'Completed',
    className:
      'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300 dark:border-emerald-400/30',
  },
  paused: {
    label: 'Paused',
    className:
      'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300 dark:border-amber-400/30',
  },
};

export function LibraryDashboard({
  user,
  movies,
  moviesMap,
  library,
  progressMap,
  activity,
  activityHasMore,
  activityLoadingMore,
  activityTitleFilter,
  achievements,
  ratings,
  loading,
  initialTab = 'library',
  onChangeActivityFilter,
  onLoadMoreActivity,
  onAddToLibrary,
  onUpdateStatus,
  onRemoveFromLibrary,
  onRateTitle,
  onPlayMovie,
  onSelectMovie,
}: LibraryDashboardProps) {
  const [activeTab, setActiveTab] = useState<LibraryTabKey>(initialTab);

  // Add to Library modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedAddMovieId, setSelectedAddMovieId] = useState('');
  const [selectedAddStatus, setSelectedAddStatus] = useState<LibraryStatus>('watching');
  const [addingSubmitting, setAddingSubmitting] = useState(false);
  const [addError, setAddError] = useState('');

  // Rate Title modal state
  const [rateTargetMovie, setRateTargetMovie] = useState<MovieItem | null>(null);
  const [rateDraft, setRateDraft] = useState<number>(5);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // Remove confirmation dialog state
  const [removeTarget, setRemoveTarget] = useState<LibraryItem | null>(null);
  const [removing, setRemoving] = useState(false);

  // View Achievement modal state
  const [viewingAchievement, setViewingAchievement] = useState<AchievementItem | null>(null);

  const stats = useMemo(
    () =>
      deriveLibraryStats({
        library,
        progressMap,
        activity,
        achievements,
      }),
    [library, progressMap, activity, achievements]
  );

  const libraryIds = useMemo(() => new Set(library.map((l) => l.titleId)), [library]);

  const availableToAdd = useMemo(
    () => movies.filter((m) => !libraryIds.has(m.id)),
    [movies, libraryIds]
  );

  const progressEntries = useMemo(() => {
    const combinedIds = new Set<string>([
      ...library.map((l) => l.titleId),
      ...Object.keys(progressMap),
    ]);
    return Array.from(combinedIds)
      .map((titleId) => {
        const lib = library.find((l) => l.titleId === titleId);
        const movie = moviesMap[titleId];
        const prog = progressMap[titleId];
        if (!prog && !lib) return null;
        return {
          titleId,
          titleName: lib?.titleName || movie?.title || titleId,
          titleType: lib?.titleType || movie?.type || 'movie',
          posterUrl: lib?.posterUrl || movie?.posterUrl || '',
          movie,
          progress: prog ?? {
            titleId,
            totalUnits: 1,
            completedUnits: lib?.status === 'completed' ? 1 : 0,
            completedEpisodeIds: [],
            progressPercent: lib?.status === 'completed' ? 100 : 0,
            updatedAt: lib?.addedAt || new Date().toISOString(),
          },
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.progress.updatedAt.localeCompare(a.progress.updatedAt));
  }, [library, progressMap, moviesMap]);

  const activityFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of library) {
      map.set(item.titleId, item.titleName);
    }
    for (const item of activity) {
      if (!map.has(item.titleId)) {
        map.set(item.titleId, item.titleName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [library, activity]);

  const openAddModal = () => {
    setAddError('');
    setSelectedAddStatus('watching');
    setSelectedAddMovieId(availableToAdd[0]?.id ?? '');
    setAddModalOpen(true);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    const movie = moviesMap[selectedAddMovieId];
    if (!movie) {
      setAddError('Please select a title to add to your library.');
      return;
    }
    setAddingSubmitting(true);
    try {
      await onAddToLibrary(movie, selectedAddStatus);
      setAddModalOpen(false);
    } catch {
      setAddError('Could not save this title to your library. Please try again.');
    } finally {
      setAddingSubmitting(false);
    }
  };

  const openRateModal = (movie: MovieItem) => {
    setRateTargetMovie(movie);
    setRateDraft(ratings[movie.id] || 5);
  };

  const handleRateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rateTargetMovie || rateDraft < 1 || rateDraft > 5) return;
    setRatingSubmitting(true);
    try {
      await onRateTitle(rateTargetMovie, rateDraft);
      setRateTargetMovie(null);
    } finally {
      setRatingSubmitting(false);
    }
  };

  const tabs: Array<{ key: LibraryTabKey; label: string; count: number; icon: React.ReactNode }> = [
    {
      key: 'library',
      label: 'My Library',
      count: library.length,
      icon: <BookMarked className="h-4 w-4" />,
    },
    {
      key: 'progress',
      label: 'Watch Progress',
      count: progressEntries.length,
      icon: <Clock className="h-4 w-4" />,
    },
    {
      key: 'activity',
      label: 'Activity',
      count: activity.length,
      icon: <ActivityIcon className="h-4 w-4" />,
    },
    {
      key: 'achievements',
      label: 'Achievements',
      count: achievements.length,
      icon: <Award className="h-4 w-4" />,
    },
  ];

  return (
    <section
      id="my-library-dashboard"
      aria-label="My Library Dashboard"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      {/* Header & CTA */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--kv-accent,#e50914)]">
            Personal Library
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome back, {user.displayName}
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Track titles, episode progress, activity history, and completion achievements in real time.
          </p>
        </div>

        <button
          type="button"
          onClick={openAddModal}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          Add to Library
        </button>
      </div>

      {/* Live Snapshot Summary Metrics */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Titles in Library</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums">{stats.totalTitles}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Completed</p>
          <p className="mt-2 font-display text-2xl font-bold text-emerald-500 tabular-nums">
            {stats.completedTitles}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Hours Watched</p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums">{stats.hoursWatched}h</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Achievements</p>
          <p className="mt-2 font-display text-2xl font-bold text-amber-500 tabular-nums">
            {stats.achievementsCount}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Library sections"
        className="mt-6 flex items-center gap-2 overflow-x-auto border-b border-zinc-200 pb-3 dark:border-zinc-800"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-[var(--kv-accent,#e50914)] text-white shadow-sm'
                  : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#13131c] dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                  isActive
                    ? 'bg-black/25 text-white'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="h-40 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-[#13131c]"
            />
          ))}
        </div>
      ) : (
        <div className="mt-6">
          {/* TAB 1: MY LIBRARY */}
          {activeTab === 'library' && (
            <>
              {library.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-[#13131c]">
                  <BookMarked className="mx-auto h-10 w-10 text-zinc-400" />
                  <h3 className="mt-3 font-display text-lg font-semibold">Your library is empty</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                    Add movies or series to track your watch status, episode progress, ratings, and completion awards.
                  </p>
                  <button
                    type="button"
                    onClick={openAddModal}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                  >
                    <Plus className="h-4 w-4" />
                    Add Your First Title
                  </button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {library.map((item) => {
                    const movie = moviesMap[item.titleId];
                    const prog = progressMap[item.titleId];
                    const badge = STATUS_BADGE_MAP[item.status] || STATUS_BADGE_MAP.watching;
                    const userRating = ratings[item.titleId] || 0;

                    return (
                      <article
                        key={item.titleId}
                        className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-[#13131c] dark:hover:border-zinc-700"
                      >
                        <div className="flex gap-3.5">
                          <button
                            type="button"
                            onClick={() => movie && onSelectMovie(movie)}
                            className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-900"
                          >
                            {item.posterUrl || movie?.posterUrl ? (
                              <img
                                src={item.posterUrl || movie?.posterUrl}
                                alt={item.titleName}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-zinc-400">
                                <Film className="h-5 w-5" />
                              </div>
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => movie && onSelectMovie(movie)}
                                className="truncate text-left font-display text-base font-semibold hover:text-[var(--kv-accent,#e50914)]"
                              >
                                {item.titleName}
                              </button>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                              <span className="uppercase text-[11px] text-zinc-500 dark:text-zinc-400">
                                {item.titleType}
                              </span>
                            </div>

                            {prog && (
                              <div className="mt-3">
                                <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                                  <span>
                                    {prog.completedUnits} of {prog.totalUnits}{' '}
                                    {item.titleType === 'series' ? 'episodes' : 'unit'}
                                  </span>
                                  <span>{prog.progressPercent}%</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                                  <div
                                    className="h-full rounded-full bg-[var(--kv-accent,#e50914)] transition-all"
                                    style={{ width: `${prog.progressPercent}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/80">
                          <div className="flex items-center gap-2">
                            {movie && (
                              <button
                                type="button"
                                onClick={() => onPlayMovie(movie)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                                Watch
                              </button>
                            )}
                            {movie && (
                              <button
                                type="button"
                                onClick={() => openRateModal(movie)}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              >
                                <Star
                                  className={`h-3.5 w-3.5 ${
                                    userRating > 0 ? 'fill-amber-400 text-amber-400' : 'text-zinc-400'
                                  }`}
                                />
                                {userRating > 0 ? `${userRating}/5` : 'Rate'}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Status for ${item.titleName}`}
                              value={item.status}
                              onChange={(e) =>
                                void onUpdateStatus(item, e.target.value as LibraryStatus)
                              }
                              className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              <option value="watching">Watching</option>
                              <option value="paused">Paused</option>
                              <option value="completed">Completed</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => setRemoveTarget(item)}
                              aria-label={`Remove ${item.titleName} from library`}
                              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* TAB 2: WATCH PROGRESS */}
          {activeTab === 'progress' && (
            <>
              {progressEntries.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-[#13131c]">
                  <Clock className="mx-auto h-10 w-10 text-zinc-400" />
                  <h3 className="mt-3 font-display text-lg font-semibold">No watch progress yet</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                    Finish at least 90% of any episode or movie to record completion and unlock achievements automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {progressEntries.map((entry) => {
                    const { progress, movie } = entry;
                    const unitLabel = entry.titleType === 'series' ? 'episodes' : 'unit';
                    return (
                      <div
                        key={entry.titleId}
                        className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c] sm:flex-row sm:items-center"
                      >
                        <div className="flex flex-1 items-center gap-3.5 min-w-0">
                          {entry.posterUrl ? (
                            <img
                              src={entry.posterUrl}
                              alt={entry.titleName}
                              referrerPolicy="no-referrer"
                              className="h-16 w-12 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-400 dark:bg-zinc-800">
                              <Film className="h-5 w-5" />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="truncate font-display text-sm font-semibold sm:text-base">
                                {entry.titleName}
                              </p>
                              <span className="font-mono-tabular text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                                {progress.completedUnits} of {progress.totalUnits} {unitLabel} ·{' '}
                                {progress.progressPercent}%
                              </span>
                            </div>

                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  progress.progressPercent >= 100
                                    ? 'bg-emerald-500'
                                    : 'bg-[var(--kv-accent,#e50914)]'
                                }`}
                                style={{ width: `${progress.progressPercent}%` }}
                              />
                            </div>

                            <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                              Updated {formatRelativeTime(progress.updatedAt)}
                            </p>
                          </div>
                        </div>

                        {movie && (
                          <button
                            type="button"
                            onClick={() => onPlayMovie(movie)}
                            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            <Play className="h-3.5 w-3.5" />
                            {progress.progressPercent >= 100 ? 'Rewatch' : 'Resume'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* TAB 3: ACTIVITY */}
          {activeTab === 'activity' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Append-only log of watches, completions, ratings, and library additions.
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor="activity-title-filter" className="text-xs font-medium text-zinc-500">
                    Filter by title:
                  </label>
                  <select
                    id="activity-title-filter"
                    value={activityTitleFilter ?? ''}
                    onChange={(e) => onChangeActivityFilter(e.target.value || null)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">All Titles</option>
                    {activityFilterOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {activity.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-[#13131c]">
                  <ActivityIcon className="mx-auto h-10 w-10 text-zinc-400" />
                  <h3 className="mt-3 font-display text-lg font-semibold">No activity recorded yet</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                    Add titles, rate shows, or finish watching an episode to populate your activity timeline.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-[#13131c]">
                  {activity.map((entry) => {
                    const icon =
                      entry.type === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : entry.type === 'rating' ? (
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      ) : entry.type === 'watch' ? (
                        <Play className="h-4 w-4 text-sky-500" />
                      ) : (
                        <BookMarked className="h-4 w-4 text-[var(--kv-accent,#e50914)]" />
                      );

                    const description =
                      entry.type === 'completed'
                        ? `Completed ${entry.titleName}`
                        : entry.type === 'rating'
                        ? `Rated ${entry.titleName} ${entry.rating ?? 5}/5 stars`
                        : entry.type === 'watch'
                        ? `Finished watching ${entry.titleName}${
                            entry.durationSeconds
                              ? ` (${formatDuration(Math.max(1, Math.round(entry.durationSeconds / 60)))})`
                              : ''
                          }`
                        : `Added ${entry.titleName} to library`;

                    return (
                      <div key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                            {icon}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{description}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                              {new Date(entry.createdAt).toLocaleString()} ·{' '}
                              {formatRelativeTime(entry.createdAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activityHasMore && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={activityLoadingMore}
                    onClick={() => void onLoadMoreActivity()}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-[#13131c] dark:hover:bg-zinc-800"
                  >
                    {activityLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Load more
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: ACHIEVEMENTS */}
          {activeTab === 'achievements' && (
            <>
              {achievements.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-[#13131c]">
                  <Trophy className="mx-auto h-10 w-10 text-zinc-400" />
                  <h3 className="mt-3 font-display text-lg font-semibold">No achievements unlocked yet</h3>
                  <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                    Reach 100% completion on any movie or series to earn a permanent completion achievement.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {achievements.map((ach) => (
                    <article
                      key={ach.id}
                      className="flex flex-col justify-between gap-4 rounded-xl border border-amber-500/30 bg-white p-5 dark:border-amber-500/25 dark:bg-[#13131c]"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
                          <Trophy className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-500">
                            <Sparkles className="h-3 w-3" />
                            Title Completed
                          </span>
                          <h3 className="mt-0.5 truncate font-display text-base font-bold">
                            {ach.titleName}
                          </h3>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Issued {ach.issuedAt.slice(0, 10)}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setViewingAchievement(ach)}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        View Achievement
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* MODAL 1: Add to Library */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add Title to Library"
      >
        <form onSubmit={handleAddSubmit} className="space-y-4">
          {availableToAdd.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              All published catalog titles are already in your library.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="add-lib-title" className="mb-1.5 block text-xs font-medium text-zinc-500">
                  Select Title
                </label>
                <select
                  id="add-lib-title"
                  value={selectedAddMovieId}
                  onChange={(e) => setSelectedAddMovieId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {availableToAdd.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} ({m.type === 'series' ? 'Series' : 'Movie'} · {m.releaseYear})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="add-lib-status" className="mb-1.5 block text-xs font-medium text-zinc-500">
                  Initial Status
                </label>
                <select
                  id="add-lib-status"
                  value={selectedAddStatus}
                  onChange={(e) => setSelectedAddStatus(e.target.value as LibraryStatus)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="watching">Watching</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </>
          )}

          {addError && <p className="text-xs text-rose-500">{addError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddModalOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium dark:border-zinc-700"
            >
              Cancel
            </button>
            {availableToAdd.length > 0 && (
              <button
                type="submit"
                disabled={addingSubmitting}
                className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {addingSubmitting ? 'Saving...' : 'Add to Library'}
              </button>
            )}
          </div>
        </form>
      </Modal>

      {/* MODAL 2: Rate Title */}
      <Modal
        open={Boolean(rateTargetMovie)}
        onClose={() => setRateTargetMovie(null)}
        title={rateTargetMovie ? `Rate ${rateTargetMovie.title}` : 'Rate Title'}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleRateSubmit} className="space-y-5">
          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Select a rating from 1 to 5 stars. This updates your personal rating and records an activity entry.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2" role="group" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRateDraft(star)}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  className={`rounded-lg p-2 transition-transform hover:scale-110 ${
                    star <= rateDraft
                      ? 'text-amber-400'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Star className={`h-7 w-7 ${star <= rateDraft ? 'fill-current' : ''}`} />
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs font-semibold tabular-nums">
              {rateDraft} / 5 stars
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRateTargetMovie(null)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium dark:border-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={ratingSubmitting}
              className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {ratingSubmitting ? 'Saving...' : 'Save Rating'}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL 3: Remove from Library ConfirmDialog */}
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove from Library"
        message={
          removeTarget
            ? `Remove "${removeTarget.titleName}" from your library? Your completion achievements and activity log are preserved.`
            : ''
        }
        confirmLabel="Remove"
        danger
        loading={removing}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return;
          setRemoving(true);
          try {
            await onRemoveFromLibrary(removeTarget);
            setRemoveTarget(null);
          } finally {
            setRemoving(false);
          }
        }}
      />

      {/* MODAL 4: View Achievement */}
      <Modal
        open={Boolean(viewingAchievement)}
        onClose={() => setViewingAchievement(null)}
        title="Completion Achievement"
        maxWidthClass="max-w-lg"
      >
        {viewingAchievement && (
          <div className="space-y-5">
            <div className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-br from-[#191624] via-[#13131c] to-[#231910] p-6 text-white shadow-inner">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-amber-400">
                    <Trophy className="h-3.5 w-3.5" />
                    AIname Completion Seal
                  </span>
                  <h3 className="mt-2 font-display text-2xl font-bold leading-tight">
                    {viewingAchievement.titleName}
                  </h3>
                  <p className="mt-2 text-sm text-zinc-300">
                    Awarded to <span className="font-semibold text-white">{user.displayName}</span> for
                    100% completion.
                  </p>
                </div>
                {viewingAchievement.imageUrl && (
                  <img
                    src={viewingAchievement.imageUrl}
                    alt={viewingAchievement.titleName}
                    referrerPolicy="no-referrer"
                    className="h-24 w-16 shrink-0 rounded-lg border border-white/15 object-cover shadow-lg"
                  />
                )}
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-zinc-400">
                <span>Credential ID: {viewingAchievement.id}</span>
                <span>Issued {new Date(viewingAchievement.issuedAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setViewingAchievement(null)}
                className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
