import React, { useMemo, useState } from 'react';
import { Check, Film, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import type {
  AdGlobalSettings,
  AdUnlockRecord,
  BrowseFilters,
  CustomAdItem,
  GenreItem,
  HomeLayoutSettings,
  MovieItem,
  SeriesEpisodeSummary,
  ShapeSettings,
  SortOption,
  SubscriptionPlan,
  UserProfile,
  WatchHistoryItem,
} from '../../types/streaming';
import { filterMovies, searchMovies, sortMovies } from '../../utils/catalog';
import { CustomAdSlot } from './CustomAdSlot';
import { MovieCard, MovieCardSkeleton } from './MovieCard';

interface BrowseViewProps {
  title: string;
  subtitle?: string;
  movies: MovieItem[];
  genres: GenreItem[];
  initialType?: 'all' | 'movie' | 'series';
  initialGenre?: string;
  searchQuery?: string;
  loading?: boolean;
  watchlistIds: Set<string>;
  historyMap: Record<string, WatchHistoryItem>;
  shape?: ShapeSettings;
  homeLayout?: HomeLayoutSettings;
  user?: UserProfile | null;
  plans?: SubscriptionPlan[];
  unlocksMap?: Record<string, AdUnlockRecord>;
  seriesSummariesMap?: Record<string, SeriesEpisodeSummary>;
  isMobile?: boolean;
  customAds?: CustomAdItem[];
  adSettings?: AdGlobalSettings;
  quickAddCatalog?: MovieItem[];
  onSelectMovie: (movie: MovieItem) => void;
  onPlayMovie: (movie: MovieItem) => void;
  onToggleWatchlist: (movie: MovieItem) => void;
}

export function BrowseView({
  title,
  subtitle,
  movies,
  genres,
  initialType = 'all',
  initialGenre = 'all',
  searchQuery = '',
  loading = false,
  watchlistIds,
  historyMap,
  shape,
  homeLayout,
  user = null,
  plans = [],
  unlocksMap = {},
  seriesSummariesMap = {},
  isMobile = false,
  customAds = [],
  adSettings,
  quickAddCatalog,
  onSelectMovie,
  onPlayMovie,
  onToggleWatchlist,
}: BrowseViewProps) {
  const [filters, setFilters] = useState<BrowseFilters>({
    type: initialType,
    genre: initialGenre,
    minRating: 0,
    language: 'all',
    access: 'all',
    minYear: 1920,
    maxYear: 2027,
  });
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [visibleCount, setVisibleCount] = useState(12);
  const [showFilters, setShowFilters] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickBrowseOpen, setQuickBrowseOpen] = useState(false);
  const [quickFeedback, setQuickFeedback] = useState('');

  const languages = useMemo(() => {
    const set = new Set(movies.map((m) => m.language).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [movies]);

  const results = useMemo(() => {
    const searched = searchQuery ? searchMovies(movies, searchQuery) : movies;
    const filtered = filterMovies(searched, {
      ...filters,
      type: filters.type ?? initialType,
      genre: filters.genre ?? initialGenre,
    });
    return sortMovies(filtered, sortBy);
  }, [movies, searchQuery, filters, initialType, initialGenre, sortBy]);

  const visible = results.slice(0, visibleCount);

  const quickMatches = useMemo(() => {
    if (!quickAddCatalog) return [];
    const matched = searchMovies(quickAddCatalog, quickQuery);
    // Prioritize titles not yet in My List first, keeping exact/prefix matches near the top
    const q = quickQuery.trim().toLowerCase();
    return [...matched]
      .sort((a, b) => {
        const aIn = watchlistIds.has(a.id) ? 1 : 0;
        const bIn = watchlistIds.has(b.id) ? 1 : 0;
        if (aIn !== bIn) return aIn - bIn;
        if (q) {
          const aExact = a.title.toLowerCase() === q ? 0 : a.title.toLowerCase().startsWith(q) ? 1 : 2;
          const bExact = b.title.toLowerCase() === q ? 0 : b.title.toLowerCase().startsWith(q) ? 1 : 2;
          if (aExact !== bExact) return aExact - bExact;
        }
        return b.views - a.views;
      })
      .slice(0, 8);
  }, [quickAddCatalog, quickQuery, watchlistIds]);

  const firstAddableMatch = useMemo(
    () => quickMatches.find((m) => !watchlistIds.has(m.id)) ?? null,
    [quickMatches, watchlistIds]
  );

  const handleQuickAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickFeedback('');
    if (!quickQuery.trim()) {
      setQuickBrowseOpen((open) => !open);
      return;
    }
    if (firstAddableMatch) {
      onToggleWatchlist(firstAddableMatch);
      setQuickQuery('');
      setQuickBrowseOpen(false);
      return;
    }
    if (quickMatches.length > 0) {
      setQuickFeedback('All matching titles are already in your list.');
    } else {
      setQuickFeedback('No matching catalog titles found.');
    }
  };

  const showQuickResults = Boolean(quickAddCatalog && (quickQuery.trim().length > 0 || quickBrowseOpen));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {adSettings && customAds.length > 0 && (
        <CustomAdSlot
          placement="banner"
          customAds={customAds}
          adSettings={adSettings}
          user={user}
          contentType={initialType === 'movie' ? 'movie' : initialType === 'series' ? 'tvshow' : 'all'}
          className="mb-6"
        />
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#14141c] dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
          </button>

          <select
            aria-label="Sort titles"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 outline-none dark:border-zinc-800 dark:bg-[#14141c] dark:text-zinc-200"
          >
            <option value="newest">Sort: Newest</option>
            <option value="rating">Sort: Top Rated</option>
            <option value="views">Sort: Most Viewed</option>
            <option value="title">Sort: A–Z</option>
          </select>
        </div>
      </div>

      {/* Expandable Filter Panel */}
      {showFilters && (
        <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c] sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label htmlFor="f-type" className="mb-1 block text-xs text-zinc-500">
              Type
            </label>
            <select
              id="f-type"
              value={filters.type ?? 'all'}
              onChange={(e) =>
                setFilters((f) => ({ ...f, type: e.target.value as BrowseFilters['type'] }))
              }
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs dark:border-zinc-700"
            >
              <option value="all">All</option>
              <option value="movie">Movies</option>
              <option value="series">Series</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-genre" className="mb-1 block text-xs text-zinc-500">
              Genre
            </label>
            <select
              id="f-genre"
              value={filters.genre ?? 'all'}
              onChange={(e) => setFilters((f) => ({ ...f, genre: e.target.value }))}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs dark:border-zinc-700"
            >
              <option value="all">All Genres</option>
              {genres.map((g) => (
                <option key={g.id} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-lang" className="mb-1 block text-xs text-zinc-500">
              Language
            </label>
            <select
              id="f-lang"
              value={filters.language ?? 'all'}
              onChange={(e) => setFilters((f) => ({ ...f, language: e.target.value }))}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs dark:border-zinc-700"
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {lang === 'all' ? 'All Languages' : lang}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="f-rating" className="mb-1 block text-xs text-zinc-500">
              Min Rating
            </label>
            <select
              id="f-rating"
              value={filters.minRating ?? 0}
              onChange={(e) => setFilters((f) => ({ ...f, minRating: Number(e.target.value) }))}
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs dark:border-zinc-700"
            >
              <option value={0}>Any</option>
              <option value={7}>7.0+</option>
              <option value={8}>8.0+</option>
              <option value={8.5}>8.5+</option>
            </select>
          </div>

          <div>
            <label htmlFor="f-access" className="mb-1 block text-xs text-zinc-500">
              Access
            </label>
            <select
              id="f-access"
              value={filters.access ?? 'all'}
              onChange={(e) =>
                setFilters((f) => ({ ...f, access: e.target.value as BrowseFilters['access'] }))
              }
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs dark:border-zinc-700"
            >
              <option value="all">All Access</option>
              <option value="free">Free (No Sign-In)</option>
              <option value="signin">Sign-In Required</option>
              <option value="premium">Subscription Plans</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() =>
                setFilters({
                  type: initialType,
                  genre: initialGenre,
                  minRating: 0,
                  language: 'all',
                  access: 'all',
                })
              }
              className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <MovieCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className={quickAddCatalog ? 'space-y-6' : undefined}>
          {quickAddCatalog && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-[#13131c]">
              <form
                onSubmit={handleQuickAddSubmit}
                className="flex flex-col gap-3 sm:flex-row sm:items-center"
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={quickQuery}
                    onChange={(e) => {
                      setQuickQuery(e.target.value);
                      setQuickFeedback('');
                    }}
                    placeholder="Search any movie or series to add directly to My List..."
                    aria-label="Search content to add to My List"
                    className="kv-input-radius w-full border border-zinc-300 bg-zinc-50 py-2.5 pl-10 pr-9 text-sm text-zinc-900 outline-none transition-colors focus:border-[var(--kv-accent,#e50914)] dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100"
                  />
                  {quickQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickQuery('');
                        setQuickFeedback('');
                      }}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="submit"
                    className="kv-primary-btn inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap"
                  >
                    <Plus className="h-4 w-4" />
                    {quickQuery.trim() && firstAddableMatch
                      ? `Add "${firstAddableMatch.title}"`
                      : 'Add to List'}
                  </button>
                  {quickBrowseOpen && !quickQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => setQuickBrowseOpen(false)}
                      className="rounded-lg border border-zinc-300 px-3 py-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Hide
                    </button>
                  )}
                </div>
              </form>

              {quickFeedback && (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{quickFeedback}</p>
              )}

              {showQuickResults && (
                <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  {quickMatches.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      No titles matched &ldquo;{quickQuery}&rdquo;. Try another title, genre, or cast member.
                    </p>
                  ) : (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {quickMatches.map((m) => {
                        const alreadyInList = watchlistIds.has(m.id);
                        return (
                          <div
                            key={m.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectMovie(m)}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              <img
                                src={m.posterUrl}
                                alt={m.title}
                                referrerPolicy="no-referrer"
                                className="h-12 w-9 shrink-0 rounded object-cover"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{m.title}</p>
                                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 tabular-nums">
                                  {m.releaseYear} · {m.type === 'series' ? 'Series' : 'Movie'}
                                  {m.genres.length > 0 ? ` · ${m.genres.slice(0, 2).join(', ')}` : ''}
                                </p>
                              </div>
                            </button>

                            {alreadyInList ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <Check className="h-3.5 w-3.5" />
                                Added
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onToggleWatchlist(m)}
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--kv-accent,#e50914)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 whitespace-nowrap"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-[#13131c]">
              <Film className="h-10 w-10 text-zinc-400" />
              <h2 className="mt-3 font-display text-lg font-semibold">
                {quickAddCatalog && movies.length === 0 ? 'Your list is empty' : 'No matching titles'}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                {quickAddCatalog && movies.length === 0
                  ? 'Use the search bar above to find any movie or series and add it directly to My List.'
                  : 'Try clearing your filters or searching for another title, actor, or genre.'}
              </p>
            </div>
          ) : (
            <>
              {homeLayout?.browseMode === 'carousel' ? (
                <div className="kv-row-scroll flex gap-4 overflow-x-auto pb-3">
                  {visible.map((m) => (
                    <div key={m.id} className="w-[44%] shrink-0 sm:w-[29%] md:w-[22%] lg:w-[16%]">
                      <MovieCard
                        movie={m}
                        inWatchlist={watchlistIds.has(m.id)}
                        history={historyMap[m.id]}
                        shape={shape}
                        homeLayout={homeLayout}
                        user={user}
                        plans={plans}
                        unlocksMap={unlocksMap}
                        adSettings={adSettings}
                        episodesSummary={seriesSummariesMap[m.id]}
                        isMobile={isMobile}
                        onSelect={onSelectMovie}
                        onPlay={onPlayMovie}
                        onToggleWatchlist={onToggleWatchlist}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  className={`grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 ${
                    homeLayout?.browseCardsPerRow === 3
                      ? 'lg:grid-cols-3'
                      : homeLayout?.browseCardsPerRow === 4
                      ? 'lg:grid-cols-4'
                      : homeLayout?.browseCardsPerRow === 5
                      ? 'lg:grid-cols-5'
                      : homeLayout?.browseCardsPerRow === 7
                      ? 'lg:grid-cols-7'
                      : homeLayout?.browseCardsPerRow === 8
                      ? 'lg:grid-cols-8'
                      : 'lg:grid-cols-6'
                  }`}
                >
                  {visible.map((m) => (
                    <MovieCard
                      key={m.id}
                      movie={m}
                      inWatchlist={watchlistIds.has(m.id)}
                      history={historyMap[m.id]}
                      shape={shape}
                      homeLayout={homeLayout}
                      user={user}
                      plans={plans}
                      unlocksMap={unlocksMap}
                      adSettings={adSettings}
                      episodesSummary={seriesSummariesMap[m.id]}
                      isMobile={isMobile}
                      onSelect={onSelectMovie}
                      onPlay={onPlayMovie}
                      onToggleWatchlist={onToggleWatchlist}
                    />
                  ))}
                </div>
              )}

              {results.length > visibleCount && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((c) => c + 12)}
                    className="rounded-lg border border-zinc-300 px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Load More ({results.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
