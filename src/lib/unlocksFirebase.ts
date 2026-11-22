import type { AdUnlockRecord, ContentAccessRule, MovieItem } from '../types/streaming';
import { getRecentUnlockTimestamps, pruneExpiredUnlocks } from '../utils/access';

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
  _uid: string,
  nowMs = Date.now()
): Promise<Record<string, AdUnlockRecord>> {
  return readLocalAdUnlocks(nowMs);
}

export async function saveUserAdUnlock(
  record: AdUnlockRecord,
  _uid?: string | null
): Promise<Record<string, AdUnlockRecord>> {
  const current = readLocalAdUnlocks();
  const next = { ...current, [record.contentId]: record };
  writeLocalAdUnlocks(next);
  recordUnlockTimestamp();
  return next;
}

export interface BulkEpisodeRuleUpdate {
  seriesId: string;
  seasonId: string;
  episodeId: string;
  access: ContentAccessRule;
}

export async function saveBulkAccessUpdates(_params: {
  movieUpdates?: Array<{ movie: MovieItem }>;
  episodeUpdates?: BulkEpisodeRuleUpdate[];
  adminUid: string;
  auditSummary: string;
}): Promise<number> {
  return 0;
}
