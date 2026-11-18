import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { AdUnlockRecord, ContentAccessRule, MovieItem } from '../types/streaming';
import { getRecentUnlockTimestamps, isUnlockRecordValid, pruneExpiredUnlocks } from '../utils/access';
import { db, logAdminAction, OperationType, handleFirestoreError } from './firebase';

const LOCAL_UNLOCKS_KEY = 'kv_ad_unlocks_v1';
const SESSION_UNLOCKS_KEY = 'kv_ad_unlocks_session_v1';
const UNLOCK_TIMESTAMPS_KEY = 'kv_unlock_timestamps_v1';

export function readLocalAdUnlocks(nowMs = Date.now()): Record<string, AdUnlockRecord> {
  const merged: Record<string, AdUnlockRecord> = {};
  try {
    const rawLocal = localStorage.getItem(LOCAL_UNLOCKS_KEY);
    if (rawLocal) {
      Object.assign(merged, JSON.parse(rawLocal) as Record<string, AdUnlockRecord>);
    }
  } catch {
    // Ignore storage read error
  }
  try {
    const rawSess = sessionStorage.getItem(SESSION_UNLOCKS_KEY);
    if (rawSess) {
      Object.assign(merged, JSON.parse(rawSess) as Record<string, AdUnlockRecord>);
    }
  } catch {
    // Ignore storage read error
  }

  const pruned = pruneExpiredUnlocks(merged, nowMs);

  // Lazy cleanup if any expired entry was removed
  if (Object.keys(pruned).length !== Object.keys(merged).length) {
    writeLocalAdUnlocks(pruned);
  }
  return pruned;
}

export function writeLocalAdUnlocks(unlocksMap: Record<string, AdUnlockRecord>): void {
  const persistent: Record<string, AdUnlockRecord> = {};
  const sessionOnly: Record<string, AdUnlockRecord> = {};
  for (const [k, rec] of Object.entries(unlocksMap)) {
    if (rec.sessionOnly || rec.expiresAt === null) {
      sessionOnly[k] = rec;
    } else {
      persistent[k] = rec;
    }
  }
  try {
    localStorage.setItem(LOCAL_UNLOCKS_KEY, JSON.stringify(persistent));
  } catch {
    // Ignore storage write error
  }
  try {
    sessionStorage.setItem(SESSION_UNLOCKS_KEY, JSON.stringify(sessionOnly));
  } catch {
    // Ignore storage write error
  }
}

export function readRecentUnlockTimestamps(nowMs = Date.now()): number[] {
  try {
    const raw = localStorage.getItem(UNLOCK_TIMESTAMPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as number[];
    const recent = getRecentUnlockTimestamps(Array.isArray(parsed) ? parsed : [], nowMs);
    if (recent.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
      localStorage.setItem(UNLOCK_TIMESTAMPS_KEY, JSON.stringify(recent));
    }
    return recent;
  } catch {
    return [];
  }
}

export function recordUnlockTimestamp(nowMs = Date.now()): number[] {
  const recent = [...readRecentUnlockTimestamps(nowMs), nowMs];
  try {
    localStorage.setItem(UNLOCK_TIMESTAMPS_KEY, JSON.stringify(recent));
  } catch {
    // Ignore storage error
  }
  return recent;
}

export function subscribeToCrossTabUnlocks(
  onUpdate: (nextMap: Record<string, AdUnlockRecord>, nextTimestamps: number[]) => void
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_UNLOCKS_KEY || e.key === UNLOCK_TIMESTAMPS_KEY) {
      onUpdate(readLocalAdUnlocks(), readRecentUnlockTimestamps());
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export async function fetchUserAdUnlocks(
  uid: string,
  nowMs = Date.now()
): Promise<Record<string, AdUnlockRecord>> {
  const localMap = readLocalAdUnlocks(nowMs);
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'adUnlocks'));
    const remoteMap: Record<string, AdUnlockRecord> = {};
    const expiredIds: string[] = [];
    snap.docs.forEach((d) => {
      const rec = { contentId: d.id, ...(d.data() as Omit<AdUnlockRecord, 'contentId'>) };
      if (isUnlockRecordValid(rec, nowMs)) {
        remoteMap[d.id] = rec;
      } else {
        expiredIds.push(d.id);
      }
    });

    // Lazy background cleanup of expired remote unlock docs
    if (expiredIds.length > 0) {
      void Promise.all(
        expiredIds.map((id) =>
          deleteDoc(doc(db, 'users', uid, 'adUnlocks', id)).catch(() => undefined)
        )
      );
    }

    const combined = pruneExpiredUnlocks({ ...localMap, ...remoteMap }, nowMs);
    writeLocalAdUnlocks(combined);
    return combined;
  } catch {
    return localMap;
  }
}

export async function saveUserAdUnlock(
  record: AdUnlockRecord,
  uid?: string | null
): Promise<Record<string, AdUnlockRecord>> {
  const current = readLocalAdUnlocks();
  const next = { ...current, [record.contentId]: record };
  writeLocalAdUnlocks(next);
  recordUnlockTimestamp();

  if (uid) {
    const { contentId, ...payload } = record;
    const cleanPayload: Record<string, unknown> = {
      contentId,
      contentType: payload.contentType,
      uid,
      unlockedAt: payload.unlockedAt,
      expiresAt: payload.expiresAt,
      sessionOnly: Boolean(payload.sessionOnly),
      adId: payload.adId,
      adKind: payload.adKind,
      format: payload.format,
      method: payload.method,
    };
    if (payload.seriesId) {
      cleanPayload.seriesId = payload.seriesId;
    }
    try {
      await setDoc(doc(db, 'users', uid, 'adUnlocks', contentId), cleanPayload);
    } catch {
      // Non-blocking: local unlock already recorded cleanly
    }
  }
  return next;
}

export interface BulkEpisodeRuleUpdate {
  seriesId: string;
  seasonId: string;
  episodeId: string;
  access: ContentAccessRule;
}

/**
 * Persists bulk Series, Season, Movie, and Episode access changes using batched Firestore writes
 * strictly bounded to 400 operations per batch (below Firestore's 500-op hard limit).
 */
export async function saveBulkAccessUpdates(params: {
  movieUpdates?: Array<{ movie: MovieItem }>;
  episodeUpdates?: BulkEpisodeRuleUpdate[];
  adminUid: string;
  auditSummary: string;
}): Promise<number> {
  const { movieUpdates = [], episodeUpdates = [], adminUid, auditSummary } = params;
  const ops: Array<() => void> = [];
  let activeBatch = writeBatch(db);
  const batches = [activeBatch];
  let countInBatch = 0;

  const ensureCapacity = () => {
    if (countInBatch >= 400) {
      activeBatch = writeBatch(db);
      batches.push(activeBatch);
      countInBatch = 0;
    }
  };

  for (const { movie } of movieUpdates) {
    ensureCapacity();
    const { id, ...payload } = movie;
    const ref = doc(db, 'movies', id);
    const b = activeBatch;
    ops.push(() => b.set(ref, payload));
    countInBatch += 1;
  }

  for (const ep of episodeUpdates) {
    ensureCapacity();
    const ref = doc(
      db,
      'series',
      ep.seriesId,
      'seasons',
      ep.seasonId,
      'episodes',
      ep.episodeId
    );
    const b = activeBatch;
    ops.push(() => b.update(ref, { access: ep.access }));
    countInBatch += 1;
  }

  ops.forEach((fn) => fn());

  try {
    for (const batch of batches) {
      await batch.commit();
    }
    await logAdminAction(adminUid, auditSummary, 'ad-unlock-bulk');
    return movieUpdates.length + episodeUpdates.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'bulk-access-updates');
  }
}
