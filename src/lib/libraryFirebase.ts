import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type {
  AchievementItem,
  EpisodeItem,
  LibraryActivityItem,
  LibraryItem,
  LibraryStatus,
  MovieItem,
  TitleProgressItem,
} from '../types/streaming';
import {
  buildAchievementId,
  computeTitleProgress,
  getProgressUnitId,
} from '../utils/library';
import { db, handleFirestoreError, OperationType } from './firebase';

export const ACTIVITY_PAGE_SIZE = 50;

export function subscribeToUserLibrary(
  uid: string,
  onData: (items: LibraryItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'users', uid, 'library'), orderBy('addedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const items: LibraryItem[] = snap.docs.map((d) => {
        const data = d.data() as Omit<LibraryItem, 'titleId'> & { titleId?: string };
        return {
          titleId: data.titleId || d.id,
          titleName: data.titleName,
          titleType: data.titleType,
          posterUrl: data.posterUrl,
          addedAt: data.addedAt,
          status: data.status,
        };
      });
      onData(items);
    },
    (error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export function subscribeToUserProgress(
  uid: string,
  onData: (items: Record<string, TitleProgressItem>) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const col = collection(db, 'users', uid, 'progress');
  return onSnapshot(
    col,
    (snap) => {
      const map: Record<string, TitleProgressItem> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as Omit<TitleProgressItem, 'titleId'> & { titleId?: string };
        const id = data.titleId || d.id;
        map[id] = {
          titleId: id,
          totalUnits: data.totalUnits,
          completedUnits: data.completedUnits,
          completedEpisodeIds: Array.isArray(data.completedEpisodeIds)
            ? data.completedEpisodeIds
            : [],
          progressPercent: data.progressPercent,
          lastSeasonId: data.lastSeasonId ?? null,
          lastEpisodeId: data.lastEpisodeId ?? null,
          updatedAt: data.updatedAt,
        };
      });
      onData(map);
    },
    (error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export interface ActivityPageResult {
  items: LibraryActivityItem[];
  lastDoc: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

function mapActivityDoc(d: QueryDocumentSnapshot): LibraryActivityItem {
  const data = d.data() as Omit<LibraryActivityItem, 'id'>;
  return {
    id: d.id,
    type: data.type,
    titleId: data.titleId,
    titleName: data.titleName,
    episodeId: data.episodeId,
    durationSeconds: data.durationSeconds,
    rating: data.rating,
    createdAt: data.createdAt,
  };
}

export function subscribeToUserActivity(
  uid: string,
  titleFilterId: string | null,
  onData: (result: ActivityPageResult) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const base = collection(db, 'users', uid, 'activity');
  const q = titleFilterId
    ? query(
        base,
        where('titleId', '==', titleFilterId),
        orderBy('createdAt', 'desc'),
        limit(ACTIVITY_PAGE_SIZE)
      )
    : query(base, orderBy('createdAt', 'desc'), limit(ACTIVITY_PAGE_SIZE));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map(mapActivityDoc);
      const lastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
      onData({
        items,
        lastDoc,
        hasMore: snap.docs.length === ACTIVITY_PAGE_SIZE,
      });
    },
    (error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export async function fetchMoreUserActivity(
  uid: string,
  cursor: QueryDocumentSnapshot,
  titleFilterId: string | null
): Promise<ActivityPageResult> {
  const path = `users/${uid}/activity`;
  try {
    const base = collection(db, 'users', uid, 'activity');
    const q = titleFilterId
      ? query(
          base,
          where('titleId', '==', titleFilterId),
          orderBy('createdAt', 'desc'),
          startAfter(cursor),
          limit(ACTIVITY_PAGE_SIZE)
        )
      : query(base, orderBy('createdAt', 'desc'), startAfter(cursor), limit(ACTIVITY_PAGE_SIZE));

    const snap = await getDocs(q);
    return {
      items: snap.docs.map(mapActivityDoc),
      lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length === ACTIVITY_PAGE_SIZE,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToUserAchievements(
  uid: string,
  onData: (items: AchievementItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'users', uid, 'achievements'), orderBy('issuedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const items: AchievementItem[] = snap.docs.map((d) => {
        const data = d.data() as Omit<AchievementItem, 'id'>;
        return {
          id: d.id,
          kind: data.kind,
          titleId: data.titleId,
          titleName: data.titleName,
          issuedAt: data.issuedAt,
          imageUrl: data.imageUrl,
        };
      });
      onData(items);
    },
    (error) => {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export async function addTitleToLibrary(
  uid: string,
  movie: MovieItem,
  status: LibraryStatus = 'watching'
): Promise<LibraryItem> {
  const path = `users/${uid}/library/${movie.id}`;
  const nowIso = new Date().toISOString();
  const safeName = movie.title.slice(0, 180);
  const libItem: LibraryItem = {
    titleId: movie.id,
    titleName: safeName,
    titleType: movie.type,
    ...(movie.posterUrl ? { posterUrl: movie.posterUrl.slice(0, 1500) } : {}),
    addedAt: nowIso,
    status,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'library', movie.id), libItem);
    batch.set(doc(collection(db, 'users', uid, 'activity')), {
      type: 'library',
      titleId: movie.id,
      titleName: safeName,
      createdAt: nowIso,
    });

    if (status === 'completed') {
      batch.set(doc(db, 'users', uid, 'progress', movie.id), {
        titleId: movie.id,
        totalUnits: 1,
        completedUnits: 1,
        completedEpisodeIds: [movie.id],
        progressPercent: 100,
        updatedAt: nowIso,
      });
      const achId = buildAchievementId('title_completed', movie.id);
      const achRef = doc(db, 'users', uid, 'achievements', achId);
      const achSnap = await getDoc(achRef).catch(() => null);
      if (!achSnap?.exists()) {
        batch.set(achRef, {
          kind: 'title_completed',
          titleId: movie.id,
          titleName: safeName,
          issuedAt: nowIso,
          ...(movie.posterUrl ? { imageUrl: movie.posterUrl.slice(0, 1500) } : {}),
        });
      }
    }

    await batch.commit();
    return libItem;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateLibraryStatus(
  uid: string,
  item: LibraryItem,
  status: LibraryStatus
): Promise<void> {
  const path = `users/${uid}/library/${item.titleId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'library', item.titleId), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function removeTitleFromLibrary(uid: string, titleId: string): Promise<void> {
  const path = `users/${uid}/library/${titleId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'library', titleId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function rateLibraryTitle(
  uid: string,
  movie: MovieItem,
  rating: number
): Promise<void> {
  const path = `users/${uid}/ratings/${movie.id}`;
  const clamped = Math.min(5, Math.max(1, Math.round(rating)));
  const nowIso = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'ratings', movie.id), { value: clamped });
    batch.set(doc(collection(db, 'users', uid, 'activity')), {
      type: 'rating',
      titleId: movie.id,
      titleName: movie.title.slice(0, 180),
      rating: clamped,
      createdAt: nowIso,
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface RecordCompletionParams {
  uid: string;
  movie: MovieItem;
  episode?: EpisodeItem | null;
  totalEpisodesCount: number;
  durationSeconds: number;
  prevProgress?: TitleProgressItem;
  existingLibraryItem?: LibraryItem;
}

export interface RecordCompletionResult {
  progress: TitleProgressItem;
  didCompleteTitle: boolean;
  achievementIssued: boolean;
}

/**
 * Atomically records a completed episode (or movie = 1 unit) at >= 90% in ONE writeBatch:
 * updates progress using arrayUnion, appends watch (+ completed) activity, marks library
 * 'completed' at 100%, and issues deterministic achievement doc at 100%.
 */
export async function recordUnitCompletionBatch({
  uid,
  movie,
  episode,
  totalEpisodesCount,
  durationSeconds,
  prevProgress,
  existingLibraryItem,
}: RecordCompletionParams): Promise<RecordCompletionResult> {
  const unitId = getProgressUnitId(movie, episode);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const completedIso = new Date(nowMs + 1).toISOString();
  const safeName = movie.title.slice(0, 180);

  const progressRef = doc(db, 'users', uid, 'progress', movie.id);
  let baseCompletedIds = prevProgress?.completedEpisodeIds ?? [];
  if (!prevProgress) {
    const snap = await getDoc(progressRef).catch(() => null);
    if (snap?.exists()) {
      const data = snap.data() as Partial<TitleProgressItem>;
      if (Array.isArray(data.completedEpisodeIds)) {
        baseCompletedIds = data.completedEpisodeIds;
      }
    }
  }

  const computed = computeTitleProgress({
    titleId: movie.id,
    titleType: movie.type,
    totalEpisodesCount,
    prevCompletedEpisodeIds: baseCompletedIds,
    newlyCompletedUnitId: unitId,
    lastSeasonId: episode?.seasonId ?? null,
    lastEpisodeId: episode?.id ?? null,
    updatedAt: nowIso,
  });

  if (computed.alreadyCompletedUnit) {
    return {
      progress: computed.progress,
      didCompleteTitle: computed.didCompleteTitle,
      achievementIssued: false,
    };
  }

  const path = `users/${uid}/progress/${movie.id}`;
  try {
    const batch = writeBatch(db);

    const progressPayload: Record<string, unknown> = {
      titleId: movie.id,
      totalUnits: computed.progress.totalUnits,
      completedUnits: computed.progress.completedUnits,
      completedEpisodeIds: arrayUnion(unitId),
      progressPercent: computed.progress.progressPercent,
      updatedAt: nowIso,
    };
    if (episode?.seasonId) progressPayload.lastSeasonId = episode.seasonId;
    if (episode?.id) progressPayload.lastEpisodeId = episode.id;

    batch.set(progressRef, progressPayload, { merge: true });

    const libStatus: LibraryStatus = computed.didCompleteTitle
      ? 'completed'
      : existingLibraryItem?.status || 'watching';
    const libPayload: Record<string, unknown> = {
      titleId: movie.id,
      titleName: safeName,
      titleType: movie.type,
      addedAt: existingLibraryItem?.addedAt || nowIso,
      status: libStatus,
    };
    if (movie.posterUrl) libPayload.posterUrl = movie.posterUrl.slice(0, 1500);
    batch.set(doc(db, 'users', uid, 'library', movie.id), libPayload, { merge: true });

    const watchActivity: Record<string, unknown> = {
      type: 'watch',
      titleId: movie.id,
      titleName: safeName,
      durationSeconds: Math.min(86400, Math.max(0, Math.round(durationSeconds))),
      createdAt: nowIso,
    };
    if (episode?.id) watchActivity.episodeId = episode.id;
    batch.set(doc(collection(db, 'users', uid, 'activity')), watchActivity);

    let achievementIssued = false;
    if (computed.didCompleteTitle) {
      batch.set(doc(collection(db, 'users', uid, 'activity')), {
        type: 'completed',
        titleId: movie.id,
        titleName: safeName,
        createdAt: completedIso,
      });

      const achId = buildAchievementId('title_completed', movie.id);
      const achRef = doc(db, 'users', uid, 'achievements', achId);
      const existingAch = await getDoc(achRef).catch(() => null);
      if (!existingAch?.exists()) {
        const achPayload: Record<string, unknown> = {
          kind: 'title_completed',
          titleId: movie.id,
          titleName: safeName,
          issuedAt: completedIso,
        };
        if (movie.posterUrl) achPayload.imageUrl = movie.posterUrl.slice(0, 1500);
        batch.set(achRef, achPayload);
        achievementIssued = true;
      }
    }

    await batch.commit();
    return {
      progress: computed.progress,
      didCompleteTitle: computed.didCompleteTitle,
      achievementIssued,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function ensureProgressDocForCompletedLibrary(
  uid: string,
  movie: MovieItem
): Promise<void> {
  const ref = doc(db, 'users', uid, 'progress', movie.id);
  const snap = await getDoc(ref).catch(() => null);
  if (!snap?.exists()) {
    await setDoc(ref, {
      titleId: movie.id,
      totalUnits: 1,
      completedUnits: 1,
      completedEpisodeIds: [movie.id],
      progressPercent: 100,
      updatedAt: new Date().toISOString(),
    });
  }
}
