import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MovieItem } from '../types/streaming';
import {
  buildAchievementId,
  computeTitleProgress,
  deriveLibraryStats,
  getProgressUnitId,
  isEpisodeCompleted,
  planGuestMerge,
  sanitizeLibraryStatus,
} from './library';

const SAMPLE_MOVIE: MovieItem = {
  id: 'mov-1',
  title: 'Neon Horizon',
  slug: 'neon-horizon',
  type: 'movie',
  description: 'Sci-fi feature',
  releaseYear: 2025,
  duration: 120,
  rating: 4.8,
  ageRating: 'PG-13',
  language: 'English',
  country: 'USA',
  genres: ['Sci-Fi'],
  cast: [],
  director: 'A. Director',
  tags: [],
  posterUrl: 'https://example.com/poster.jpg',
  bannerUrl: 'https://example.com/banner.jpg',
  trailerUrl: '',
  videoSources: [],
  subtitles: [],
  isFeatured: true,
  isTrending: false,
  isPremium: false,
  status: 'published',
  views: 10,
  likesCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SAMPLE_SERIES: MovieItem = {
  ...SAMPLE_MOVIE,
  id: 'ser-1',
  title: 'Starlight Chronicles',
  slug: 'starlight-chronicles',
  type: 'series',
};

describe('library pure utilities', () => {
  it('detects unit completion at >= 90% and guards zero duration', () => {
    assert.equal(isEpisodeCompleted(89, 100), false);
    assert.equal(isEpisodeCompleted(90, 100), true);
    assert.equal(isEpisodeCompleted(100, 100), true);
    assert.equal(isEpisodeCompleted(50, 0), false);
    assert.equal(isEpisodeCompleted(NaN, 100), false);
  });

  it('resolves progress unit ID for movies vs series episodes', () => {
    assert.equal(getProgressUnitId(SAMPLE_MOVIE, null), 'mov-1');
    assert.equal(getProgressUnitId(SAMPLE_SERIES, { id: 'ep-3' }), 'ep-3');
    assert.equal(getProgressUnitId(SAMPLE_SERIES, null), 'ser-1');
  });

  it('computes idempotent episode progress and marks completion at 100%', () => {
    const first = computeTitleProgress({
      titleId: 'ser-1',
      titleType: 'series',
      totalEpisodesCount: 2,
      prevCompletedEpisodeIds: [],
      newlyCompletedUnitId: 'ep-1',
      lastSeasonId: 's1',
      lastEpisodeId: 'ep-1',
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    assert.equal(first.progress.completedUnits, 1);
    assert.equal(first.progress.progressPercent, 50);
    assert.equal(first.alreadyCompletedUnit, false);
    assert.equal(first.didCompleteTitle, false);

    // Repeat same episode — idempotent
    const repeat = computeTitleProgress({
      titleId: 'ser-1',
      titleType: 'series',
      totalEpisodesCount: 2,
      prevCompletedEpisodeIds: first.progress.completedEpisodeIds,
      newlyCompletedUnitId: 'ep-1',
      lastSeasonId: 's1',
      lastEpisodeId: 'ep-1',
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    assert.equal(repeat.alreadyCompletedUnit, true);
    assert.equal(repeat.progress.completedUnits, 1);
    assert.equal(repeat.progress.progressPercent, 50);

    // Second episode completes series
    const second = computeTitleProgress({
      titleId: 'ser-1',
      titleType: 'series',
      totalEpisodesCount: 2,
      prevCompletedEpisodeIds: first.progress.completedEpisodeIds,
      newlyCompletedUnitId: 'ep-2',
      lastSeasonId: 's1',
      lastEpisodeId: 'ep-2',
      updatedAt: '2026-01-01T00:03:00.000Z',
    });
    assert.equal(second.progress.completedUnits, 2);
    assert.equal(second.progress.progressPercent, 100);
    assert.equal(second.didCompleteTitle, true);
  });

  it('derives summary stats from live snapshots without double-counting non-watch activity', () => {
    const stats = deriveLibraryStats({
      library: [
        {
          titleId: 'mov-1',
          titleName: 'Neon Horizon',
          titleType: 'movie',
          addedAt: '2026-01-01T00:00:00.000Z',
          status: 'completed',
        },
        {
          titleId: 'ser-1',
          titleName: 'Starlight Chronicles',
          titleType: 'series',
          addedAt: '2026-01-01T00:00:00.000Z',
          status: 'watching',
        },
      ],
      progressMap: {
        'mov-1': {
          titleId: 'mov-1',
          totalUnits: 1,
          completedUnits: 1,
          completedEpisodeIds: ['mov-1'],
          progressPercent: 100,
          updatedAt: '2026-01-01T00:05:00.000Z',
        },
      },
      activity: [
        {
          id: 'a1',
          type: 'watch',
          titleId: 'mov-1',
          titleName: 'Neon Horizon',
          durationSeconds: 3600,
          createdAt: '2026-01-01T00:05:00.000Z',
        },
        {
          id: 'a2',
          type: 'completed',
          titleId: 'mov-1',
          titleName: 'Neon Horizon',
          createdAt: '2026-01-01T00:05:01.000Z',
        },
        {
          id: 'a3',
          type: 'watch',
          titleId: 'ser-1',
          titleName: 'Starlight Chronicles',
          durationSeconds: 1800,
          createdAt: '2026-01-01T00:10:00.000Z',
        },
      ],
      achievements: [
        {
          id: 'title_completed_mov-1',
          kind: 'title_completed',
          titleId: 'mov-1',
          titleName: 'Neon Horizon',
          issuedAt: '2026-01-01T00:05:00.000Z',
        },
      ],
    });

    assert.deepEqual(stats, {
      totalTitles: 2,
      completedTitles: 1,
      hoursWatched: 1.5,
      achievementsCount: 1,
    });
  });

  it('builds deterministic achievement IDs and sanitizes status', () => {
    assert.equal(buildAchievementId('title_completed', 'mov-1'), 'title_completed_mov-1');
    assert.equal(sanitizeLibraryStatus('paused'), 'paused');
    assert.equal(sanitizeLibraryStatus('invalid'), 'watching');
  });

  it('plans one-time guest watchlist and history merge into Firestore & library without duplicates', () => {
    const plan = planGuestMerge({
      guestWatchlist: [
        { movieId: 'mov-1', addedAt: '2026-01-01T00:00:00.000Z' },
        { movieId: 'ser-1', addedAt: '2026-01-02T00:00:00.000Z' },
      ],
      guestHistory: [
        {
          movieId: 'mov-1',
          progressSeconds: 95,
          durationSeconds: 100,
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
      ],
      existingWatchlistIds: new Set(['ser-1']),
      existingHistoryMap: {},
      existingLibraryIds: new Set(['ser-1']),
      moviesMap: { 'mov-1': SAMPLE_MOVIE, 'ser-1': SAMPLE_SERIES },
      nowIso: '2026-01-04T00:00:00.000Z',
    });

    assert.equal(plan.watchlistToWrite.length, 1);
    assert.equal(plan.watchlistToWrite[0].movieId, 'mov-1');
    assert.equal(plan.historyToWrite.length, 1);
    assert.equal(plan.libraryToWrite.length, 1);
    assert.equal(plan.libraryToWrite[0].titleId, 'mov-1');
  });
});
