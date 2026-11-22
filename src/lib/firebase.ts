import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  increment,
  initializeFirestore,
  limit,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type {
  ActivityLogItem,
  BannerItem,
  CommentItem,
  ContactMessage,
  CustomPage,
  EpisodeItem,
  GenreItem,
  MovieItem,
  ReportItem,
  SiteSettings,
  SubscriptionPlan,
  UserProfile,
  WatchHistoryItem,
  WatchlistItem,
} from '../types/streaming';
import {
  DEFAULT_SITE_SETTINGS,
  SEED_BANNERS,
  SEED_COMMENTS,
  SEED_EPISODES,
  SEED_GENRES,
  SEED_MOVIES,
  SEED_PAGES,
  SEED_PLANS,
} from '../data/seedCatalog';
import { mergeSiteSettings } from '../utils/customization';
import { mapFirebaseAuthError } from '../utils/authError';
import { planGuestMerge } from '../utils/library';

const firebaseConfig = {
  apiKey: 'AIzaSyCaamGgKek0SOHfxqnU-00joLX-dA9DFh4',
  authDomain: 'ainame-76af5.firebaseapp.com',
  projectId: 'ainame-76af5',
  storageBucket: 'ainame-76af5.firebasestorage.app',
  messagingSenderId: '74950641528',
  appId: '1:74950641528:web:c08ec4344ec7c6519b6a8d',
  measurementId: 'G-62Z2BFRNMF',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

function createFirestoreInstance(): Firestore {
  try {
    if (typeof window !== 'undefined') {
      return initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    }
  } catch {
    // Fall back to default Firestore instance if persistence/HMR already initialized
  }
  return getFirestore(app);
}

export const db: Firestore = createFirestoreInstance();

if (typeof window !== 'undefined') {
  isAnalyticsSupported()
    .then((supported) => {
      if (supported) getAnalytics(app);
    })
    .catch(() => undefined);
}

export const BOOTSTRAPPED_ADMIN_EMAIL = 'krushnachaware84@gmail.com';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
    },
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw error instanceof Error ? error : new Error(errMsg);
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'settings', 'site'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore client is offline or unreachable.');
    }
    return false;
  }
}

export function isUserAdmin(profile: UserProfile | null, authUser: User | null): boolean {
  if (!authUser) return false;
  if (authUser.email === BOOTSTRAPPED_ADMIN_EMAIL && authUser.emailVerified) return true;
  return profile?.role === 'admin';
}

export function buildUserFromAuth(user: User): UserProfile {
  const isBootstrapAdmin =
    user.email === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;
  return {
    uid: user.uid,
    displayName: user.displayName || user.email?.split('@')[0] || 'Member',
    email: user.email || '',
    photoURL: user.photoURL || '',
    role: isBootstrapAdmin ? 'admin' : 'user',
    status: 'active',
    plan: isBootstrapAdmin ? 'premium' : 'free',
    subscriptionPlanId: null,
    subscriptionPlanName: null,
    planExpiresAt: null,
    createdAt: user.metadata.creationTime || new Date().toISOString(),
    lastLoginAt: user.metadata.lastSignInTime || new Date().toISOString(),
  };
}

// --- Firebase Authentication + Firestore User Profile Sync ---

export async function signInWithGooglePopup(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error, 'signin'));
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return result.user;
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error, 'signin'));
  }
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName?: string
): Promise<User> {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const cleanName = displayName?.trim().slice(0, 100);
    if (cleanName) {
      await updateProfile(result.user, { displayName: cleanName }).catch(() => undefined);
    }
    return result.user;
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error, 'signup'));
  }
}

export async function sendResetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error, 'other'));
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function updateCurrentUserPassword(newPassword: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Something went wrong. Please try again.');
  try {
    await updatePassword(auth.currentUser, newPassword);
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error, 'other'));
  }
}

export async function deleteCurrentUserAccount(): Promise<void> {
  const current = auth.currentUser;
  if (!current) throw new Error('Something went wrong. Please try again.');
  try {
    await deleteDoc(doc(db, 'users', current.uid)).catch(() => undefined);
    await deleteUser(current);
  } catch (error) {
    throw new Error(mapFirebaseAuthError(error, 'other'));
  }
}

/**
 * Syncs `users/{uid}` in Cloud Firestore without adding any extra fields.
 * Creates the document on first sign-in with role 'user', status 'active', plan 'free'.
 */
export async function syncUserProfileOnLogin(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const nowIso = new Date().toISOString();
  const fallbackName = (user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 100);
  const safeEmail = (user.email || `${user.uid}@ainame.local`).slice(0, 200);

  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      const initialDoc = {
        displayName: fallbackName,
        email: safeEmail,
        photoURL: (user.photoURL || '').slice(0, 1000),
        role: 'user' as const,
        status: 'active' as const,
        plan: 'free' as const,
        subscriptionPlanId: null,
        subscriptionPlanName: null,
        planExpiresAt: null,
        createdAt: nowIso,
        lastLoginAt: nowIso,
      };
      await setDoc(userRef, initialDoc);
      return { uid: user.uid, ...initialDoc };
    }

    const data = snap.data() as Omit<UserProfile, 'uid'>;
    await updateDoc(userRef, { lastLoginAt: nowIso });
    return {
      uid: user.uid,
      displayName: data.displayName || fallbackName,
      email: data.email || safeEmail,
      photoURL: data.photoURL || user.photoURL || '',
      role: data.role || 'user',
      status: data.status || 'active',
      plan: data.plan || 'free',
      subscriptionPlanId: data.subscriptionPlanId ?? null,
      subscriptionPlanName: data.subscriptionPlanName ?? null,
      planExpiresAt: data.planExpiresAt ?? null,
      createdAt: data.createdAt || nowIso,
      lastLoginAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateOwnUserProfile(
  uid: string,
  updates: { displayName?: string; photoURL?: string }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, string> = {
      lastLoginAt: new Date().toISOString(),
    };
    if (typeof updates.displayName === 'string' && updates.displayName.trim()) {
      payload.displayName = updates.displayName.trim().slice(0, 100);
    }
    if (typeof updates.photoURL === 'string') {
      payload.photoURL = updates.photoURL.trim().slice(0, 1000);
    }
    await updateDoc(doc(db, 'users', uid), payload);
    if (auth.currentUser && auth.currentUser.uid === uid) {
      await updateProfile(auth.currentUser, {
        displayName: payload.displayName,
        photoURL: payload.photoURL,
      }).catch(() => undefined);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function uploadFileWithProgress(
  _storagePath: string,
  _file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  onProgress?.(100);
  return Promise.reject(
    new Error('Cloud Storage is not enabled. Please paste an image URL instead.')
  );
}

// --- Catalog & Site Settings (Firestore with Seed Fallback) ---

export async function fetchSiteSettings(): Promise<SiteSettings> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'site'));
    if (snap.exists()) {
      return mergeSiteSettings(snap.data() as Partial<SiteSettings>);
    }
  } catch {
    // Fall back to default site settings when offline or unseeded
  }
  return mergeSiteSettings(DEFAULT_SITE_SETTINGS);
}

export async function fetchPublishedPages(): Promise<CustomPage[]> {
  try {
    const q = query(collection(db, 'pages'), where('status', '==', 'published'));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomPage, 'id'>) }));
    }
  } catch {
    // Fall back to seed pages
  }
  return SEED_PAGES;
}

export async function createContactMessage(
  msg: Omit<ContactMessage, 'id' | 'status' | 'createdAt'>
): Promise<ContactMessage> {
  const id = `msg-${Date.now()}`;
  const docData: Omit<ContactMessage, 'id'> = {
    name: msg.name.trim().slice(0, 100),
    email: msg.email.trim().slice(0, 200),
    subject: msg.subject.trim().slice(0, 160),
    message: msg.message.trim().slice(0, 3000),
    pageSlug: (msg.pageSlug || 'contact').slice(0, 80),
    status: 'unread',
    createdAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, 'messages', id), docData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `messages/${id}`);
  }
  return { id, ...docData };
}

export async function fetchPublishedCatalog(maxCount = 60): Promise<{
  movies: MovieItem[];
  genres: GenreItem[];
  banners: BannerItem[];
  plans: SubscriptionPlan[];
  fromSeed: boolean;
}> {
  try {
    const [moviesSnap, genresSnap, bannersSnap, plansSnap] = await Promise.all([
      getDocs(query(collection(db, 'movies'), where('status', '==', 'published'), limit(maxCount))),
      getDocs(query(collection(db, 'genres'), orderBy('order', 'asc'))),
      getDocs(query(collection(db, 'banners'), where('isActive', '==', true))),
      getDocs(query(collection(db, 'plans'), where('isActive', '==', true))),
    ]);

    if (!moviesSnap.empty) {
      const movies = moviesSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<MovieItem, 'id'>),
      }));
      const genres = genresSnap.empty
        ? SEED_GENRES
        : genresSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GenreItem, 'id'>) }));
      const banners = bannersSnap.empty
        ? SEED_BANNERS.filter((b) => b.isActive)
        : bannersSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<BannerItem, 'id'>) }))
            .sort((a, b) => a.order - b.order);
      const plans = plansSnap.empty
        ? SEED_PLANS.filter((p) => p.isActive)
        : plansSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SubscriptionPlan, 'id'>) }))
            .sort((a, b) => a.order - b.order);

      return { movies, genres, banners, plans, fromSeed: false };
    }
  } catch {
    // Fall back to seed catalog if Firestore is unseeded or offline
  }

  return {
    movies: SEED_MOVIES.filter((m) => m.status === 'published'),
    genres: SEED_GENRES,
    banners: SEED_BANNERS.filter((b) => b.isActive),
    plans: SEED_PLANS.filter((p) => p.isActive),
    fromSeed: true,
  };
}

export async function cancelUserSubscription(uid: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      plan: 'free',
      subscriptionPlanId: null,
      subscriptionPlanName: null,
      planExpiresAt: null,
      lastLoginAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function fetchSeriesEpisodes(seriesId: string): Promise<EpisodeItem[]> {
  try {
    const collected: EpisodeItem[] = [];
    for (let seasonNum = 1; seasonNum <= 10; seasonNum += 1) {
      const seasonId = `season-${seasonNum}`;
      const snap = await getDocs(
        collection(db, 'series', seriesId, 'seasons', seasonId, 'episodes')
      );
      if (!snap.empty) {
        snap.docs.forEach((d) => {
          const data = d.data() as Omit<EpisodeItem, 'id' | 'seriesId' | 'seasonId'>;
          collected.push({
            ...data,
            id: d.id,
            seriesId,
            seasonId,
            seasonNumber: data.seasonNumber ?? seasonNum,
          });
        });
      }
    }
    if (collected.length > 0) {
      return collected.sort((a, b) =>
        a.seasonNumber !== b.seasonNumber ? a.seasonNumber - b.seasonNumber : a.number - b.number
      );
    }
  } catch {
    // Fall back to seed episodes
  }
  return SEED_EPISODES[seriesId] ?? [];
}

// --- Personal Data Subcollections (watchlist, history, ratings, likes) ---

export async function fetchUserPersonalData(uid: string): Promise<{
  watchlist: WatchlistItem[];
  history: WatchHistoryItem[];
  ratings: Record<string, number>;
  likes: string[];
}> {
  try {
    const [watchSnap, histSnap, rateSnap, likeSnap] = await Promise.all([
      getDocs(query(collection(db, 'users', uid, 'watchlist'), orderBy('addedAt', 'desc'))),
      getDocs(query(collection(db, 'users', uid, 'history'), orderBy('updatedAt', 'desc'))),
      getDocs(collection(db, 'users', uid, 'ratings')),
      getDocs(collection(db, 'users', uid, 'likes')),
    ]);

    const watchlist: WatchlistItem[] = watchSnap.docs.map((d) => {
      const data = d.data() as Partial<WatchlistItem>;
      return {
        movieId: data.movieId || d.id,
        addedAt: data.addedAt || new Date().toISOString(),
      };
    });

    const history: WatchHistoryItem[] = histSnap.docs.map((d) => {
      const data = d.data() as Partial<WatchHistoryItem>;
      return {
        movieId: data.movieId || d.id,
        progressSeconds: typeof data.progressSeconds === 'number' ? data.progressSeconds : 0,
        durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : 0,
        ...(data.seasonId ? { seasonId: data.seasonId } : {}),
        ...(data.episodeId ? { episodeId: data.episodeId } : {}),
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    });

    const ratings: Record<string, number> = {};
    rateSnap.docs.forEach((d) => {
      const val = (d.data() as { value?: unknown }).value;
      if (typeof val === 'number') {
        ratings[d.id] = val;
      }
    });

    const likes: string[] = likeSnap.docs.map((d) => d.id);

    return { watchlist, history, ratings, likes };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `users/${uid}`);
  }
}

/**
 * Merges guest localStorage watchlist and history into Firestore once per UID on first sign-in.
 */
export async function mergeGuestDataOnFirstSignIn(
  uid: string,
  moviesMap: Record<string, MovieItem>,
  remotePersonal: {
    watchlist: WatchlistItem[];
    history: WatchHistoryItem[];
  }
): Promise<{
  merged: boolean;
  watchlist: WatchlistItem[];
  history: WatchHistoryItem[];
}> {
  const mergeKey = `kv_guest_merged_${uid}`;
  try {
    if (typeof window !== 'undefined' && localStorage.getItem(mergeKey) === '1') {
      return {
        merged: false,
        watchlist: remotePersonal.watchlist,
        history: remotePersonal.history,
      };
    }
  } catch {
    return {
      merged: false,
      watchlist: remotePersonal.watchlist,
      history: remotePersonal.history,
    };
  }

  let guestWatchlist: WatchlistItem[] = [];
  let guestHistory: WatchHistoryItem[] = [];
  try {
    guestWatchlist = JSON.parse(localStorage.getItem('kv_guest_watchlist') || '[]');
    guestHistory = JSON.parse(localStorage.getItem('kv_guest_history') || '[]');
    if (!Array.isArray(guestWatchlist)) guestWatchlist = [];
    if (!Array.isArray(guestHistory)) guestHistory = [];
  } catch {
    guestWatchlist = [];
    guestHistory = [];
  }

  if (guestWatchlist.length === 0 && guestHistory.length === 0) {
    try {
      localStorage.setItem(mergeKey, '1');
    } catch {}
    return {
      merged: false,
      watchlist: remotePersonal.watchlist,
      history: remotePersonal.history,
    };
  }

  const libSnap = await getDocs(collection(db, 'users', uid, 'library')).catch(() => null);
  const existingLibraryIds = new Set<string>(libSnap ? libSnap.docs.map((d) => d.id) : []);
  const existingWatchlistIds = new Set(remotePersonal.watchlist.map((w) => w.movieId));
  const existingHistoryMap: Record<string, WatchHistoryItem> = {};
  remotePersonal.history.forEach((h) => {
    existingHistoryMap[h.movieId] = h;
  });

  const plan = planGuestMerge({
    guestWatchlist,
    guestHistory,
    existingWatchlistIds,
    existingHistoryMap,
    existingLibraryIds,
    moviesMap,
    nowIso: new Date().toISOString(),
  });

  if (
    plan.watchlistToWrite.length > 0 ||
    plan.historyToWrite.length > 0 ||
    plan.libraryToWrite.length > 0
  ) {
    const batch = writeBatch(db);
    for (const w of plan.watchlistToWrite) {
      batch.set(doc(db, 'users', uid, 'watchlist', w.movieId), {
        movieId: w.movieId,
        addedAt: w.addedAt,
      });
    }
    for (const h of plan.historyToWrite) {
      const payload: Record<string, unknown> = {
        movieId: h.movieId,
        progressSeconds: Math.max(0, Math.round(h.progressSeconds)),
        durationSeconds: Math.max(0, Math.round(h.durationSeconds)),
        updatedAt: h.updatedAt,
      };
      if (h.seasonId) payload.seasonId = h.seasonId;
      if (h.episodeId) payload.episodeId = h.episodeId;
      batch.set(doc(db, 'users', uid, 'history', h.movieId), payload);
    }
    for (const lib of plan.libraryToWrite) {
      batch.set(doc(db, 'users', uid, 'library', lib.titleId), {
        titleId: lib.titleId,
        titleName: lib.titleName.slice(0, 180),
        titleType: lib.titleType,
        ...(lib.posterUrl ? { posterUrl: lib.posterUrl.slice(0, 1500) } : {}),
        addedAt: lib.addedAt,
        status: lib.status,
      });
    }
    await batch.commit();
  }

  try {
    localStorage.setItem(mergeKey, '1');
  } catch {}

  const mergedWatchlist = [...plan.watchlistToWrite, ...remotePersonal.watchlist];
  const mergedHistoryMap: Record<string, WatchHistoryItem> = { ...existingHistoryMap };
  for (const h of plan.historyToWrite) {
    mergedHistoryMap[h.movieId] = h;
  }
  const mergedHistory = Object.values(mergedHistoryMap).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  return {
    merged:
      plan.watchlistToWrite.length > 0 ||
      plan.historyToWrite.length > 0 ||
      plan.libraryToWrite.length > 0,
    watchlist: mergedWatchlist,
    history: mergedHistory,
  };
}

export async function toggleUserWatchlist(
  uid: string,
  movieId: string,
  add: boolean
): Promise<void> {
  const path = `users/${uid}/watchlist/${movieId}`;
  try {
    const ref = doc(db, 'users', uid, 'watchlist', movieId);
    if (add) {
      await setDoc(ref, { movieId, addedAt: new Date().toISOString() });
    } else {
      await deleteDoc(ref);
    }
  } catch (error) {
    handleFirestoreError(error, add ? OperationType.WRITE : OperationType.DELETE, path);
  }
}

export async function saveUserWatchHistory(
  uid: string,
  item: WatchHistoryItem
): Promise<void> {
  const path = `users/${uid}/history/${item.movieId}`;
  try {
    const payload: Record<string, unknown> = {
      movieId: item.movieId,
      progressSeconds: Math.max(0, Math.round(item.progressSeconds)),
      durationSeconds: Math.max(0, Math.round(item.durationSeconds)),
      updatedAt: item.updatedAt,
    };
    if (item.seasonId) payload.seasonId = item.seasonId;
    if (item.episodeId) payload.episodeId = item.episodeId;
    await setDoc(doc(db, 'users', uid, 'history', item.movieId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeUserHistoryItem(uid: string, movieId: string): Promise<void> {
  const path = `users/${uid}/history/${movieId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'history', movieId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearUserHistory(uid: string, movieIds: string[]): Promise<void> {
  if (movieIds.length === 0) return;
  const path = `users/${uid}/history`;
  try {
    const batch = writeBatch(db);
    for (const movieId of movieIds) {
      batch.delete(doc(db, 'users', uid, 'history', movieId));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveUserRating(
  uid: string,
  movieId: string,
  rating: number
): Promise<void> {
  const path = `users/${uid}/ratings/${movieId}`;
  try {
    const clamped = Math.min(5, Math.max(1, Math.round(rating)));
    await setDoc(doc(db, 'users', uid, 'ratings', movieId), { value: clamped });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function toggleUserLike(
  uid: string,
  movieId: string,
  like: boolean
): Promise<void> {
  const path = `users/${uid}/likes/${movieId}`;
  try {
    const likeRef = doc(db, 'users', uid, 'likes', movieId);
    if (like) {
      await setDoc(likeRef, { movieId, addedAt: new Date().toISOString() });
    } else {
      await deleteDoc(likeRef);
    }
    // Increment movie likesCount if the movie exists in Firestore
    await updateDoc(doc(db, 'movies', movieId), {
      likesCount: increment(like ? 1 : -1),
    }).catch(() => undefined);
  } catch (error) {
    handleFirestoreError(error, like ? OperationType.WRITE : OperationType.DELETE, path);
  }
}

export async function incrementMovieViews(movieId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'movies', movieId), { views: increment(1) });
  } catch {
    // Ignore when using local seed catalog without remote movie docs
  }
}

export async function fetchMovieComments(movieId: string): Promise<CommentItem[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'comments'),
        where('movieId', '==', movieId),
        where('isHidden', '==', false)
      )
    );
    if (!snap.empty) {
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CommentItem, 'id'>) }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  } catch {
    // Fall back to seed comments
  }
  return SEED_COMMENTS.filter((c) => c.movieId === movieId && !c.isHidden);
}

export async function createComment(comment: Omit<CommentItem, 'id'>): Promise<CommentItem> {
  const id = `cmt-${Date.now()}`;
  try {
    await setDoc(doc(db, 'comments', id), comment);
  } catch {
    // Fall back to in-memory comment if movie is seed-only
  }
  return { id, ...comment };
}

export async function deleteCommentDoc(commentId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'comments', commentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `comments/${commentId}`);
  }
}

export async function createReportDoc(
  report: Omit<ReportItem, 'id' | 'status' | 'createdAt'>
): Promise<void> {
  const id = `rep-${Date.now()}`;
  const payload = {
    ...report,
    status: 'open' as const,
    createdAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(db, 'reports', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reports/${id}`);
  }
}

export async function logAdminAction(
  adminUid: string,
  action: string,
  targetId: string
): Promise<void> {
  const id = `log-${Date.now()}`;
  try {
    await setDoc(doc(db, 'activityLogs', id), {
      adminUid,
      action: action.slice(0, 200),
      targetId: targetId.slice(0, 128),
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}

export async function fetchAllAdminData(): Promise<{
  movies: MovieItem[];
  genres: GenreItem[];
  banners: BannerItem[];
  users: UserProfile[];
  comments: CommentItem[];
  reports: ReportItem[];
  logs: ActivityLogItem[];
  plans: SubscriptionPlan[];
  pages: CustomPage[];
  messages: ContactMessage[];
  settings: SiteSettings;
}> {
  try {
    const [
      moviesSnap,
      genresSnap,
      bannersSnap,
      commentsSnap,
      reportsSnap,
      logsSnap,
      plansSnap,
      pagesSnap,
      messagesSnap,
      settingsSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'movies')),
      getDocs(query(collection(db, 'genres'), orderBy('order', 'asc'))),
      getDocs(collection(db, 'banners')),
      getDocs(collection(db, 'comments')),
      getDocs(collection(db, 'reports')),
      getDocs(query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(100))),
      getDocs(collection(db, 'plans')),
      getDocs(collection(db, 'pages')),
      getDocs(collection(db, 'messages')),
      getDoc(doc(db, 'settings', 'site')),
    ]);

    return {
      movies: moviesSnap.empty
        ? SEED_MOVIES
        : moviesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MovieItem, 'id'>) })),
      genres: genresSnap.empty
        ? SEED_GENRES
        : genresSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GenreItem, 'id'>) })),
      banners: bannersSnap.empty
        ? SEED_BANNERS
        : bannersSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BannerItem, 'id'>) })),
      users: [],
      comments: commentsSnap.empty
        ? SEED_COMMENTS
        : commentsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommentItem, 'id'>) })),
      reports: reportsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReportItem, 'id'>) })),
      logs: logsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityLogItem, 'id'>) })),
      plans: plansSnap.empty
        ? SEED_PLANS
        : plansSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SubscriptionPlan, 'id'>) })),
      pages: pagesSnap.empty
        ? SEED_PAGES
        : pagesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomPage, 'id'>) })),
      messages: messagesSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ContactMessage, 'id'>),
      })),
      settings: settingsSnap.exists()
        ? mergeSiteSettings(settingsSnap.data() as Partial<SiteSettings>)
        : DEFAULT_SITE_SETTINGS,
    };
  } catch {
    return {
      movies: SEED_MOVIES,
      genres: SEED_GENRES,
      banners: SEED_BANNERS,
      users: [],
      comments: SEED_COMMENTS,
      reports: [],
      logs: [],
      plans: SEED_PLANS,
      pages: SEED_PAGES,
      messages: [],
      settings: DEFAULT_SITE_SETTINGS,
    };
  }
}

export async function saveMovieDoc(
  movie: MovieItem,
  adminUid: string,
  _isNew: boolean
): Promise<void> {
  const { id, ...rest } = movie;
  await setDoc(doc(db, 'movies', id), rest);
  await logAdminAction(adminUid, 'save_movie', id);
}

export async function deleteMovieDoc(movieId: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'movies', movieId));
  await logAdminAction(adminUid, 'delete_movie', movieId);
}

export async function saveEpisodeDoc(episode: EpisodeItem, adminUid: string): Promise<void> {
  const { id, seriesId, seasonId, ...rest } = episode;
  await setDoc(doc(db, 'series', seriesId, 'seasons', seasonId, 'episodes', id), rest);
  await logAdminAction(adminUid, 'save_episode', id);
}

export async function deleteEpisodeDoc(
  seriesId: string,
  seasonId: string,
  episodeId: string,
  adminUid: string
): Promise<void> {
  await deleteDoc(doc(db, 'series', seriesId, 'seasons', seasonId, 'episodes', episodeId));
  await logAdminAction(adminUid, 'delete_episode', episodeId);
}

export async function saveGenreDoc(genre: GenreItem, adminUid: string): Promise<void> {
  const { id, ...rest } = genre;
  await setDoc(doc(db, 'genres', id), rest);
  await logAdminAction(adminUid, 'save_genre', id);
}

export async function deleteGenreDoc(genreId: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'genres', genreId));
  await logAdminAction(adminUid, 'delete_genre', genreId);
}

export async function saveBannerDoc(banner: BannerItem, adminUid: string): Promise<void> {
  const { id, ...rest } = banner;
  await setDoc(doc(db, 'banners', id), rest);
  await logAdminAction(adminUid, 'save_banner', id);
}

export async function deleteBannerDoc(bannerId: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'banners', bannerId));
  await logAdminAction(adminUid, 'delete_banner', bannerId);
}

export async function updateAdminUserDoc(
  targetUid: string,
  updates: Partial<UserProfile>,
  adminUid: string
): Promise<void> {
  const { uid: _omit, ...rest } = updates;
  await updateDoc(doc(db, 'users', targetUid), rest);
  await logAdminAction(adminUid, 'update_user', targetUid);
}

export async function deleteAdminUserDoc(targetUid: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', targetUid));
  await logAdminAction(adminUid, 'delete_user', targetUid);
}

export async function toggleCommentVisibility(
  commentId: string,
  isHidden: boolean,
  adminUid: string
): Promise<void> {
  await updateDoc(doc(db, 'comments', commentId), { isHidden });
  await logAdminAction(adminUid, isHidden ? 'hide_comment' : 'show_comment', commentId);
}

export async function updateReportStatus(
  reportId: string,
  status: 'open' | 'resolved' | 'dismissed',
  adminUid: string
): Promise<void> {
  const safeStatus = status === 'resolved' ? 'resolved' : 'open';
  await updateDoc(doc(db, 'reports', reportId), { status: safeStatus });
  await logAdminAction(adminUid, 'update_report_status', reportId);
}

export async function saveSiteSettingsDoc(
  settings: SiteSettings,
  adminUid: string
): Promise<void> {
  await setDoc(doc(db, 'settings', 'site'), settings);
  await logAdminAction(adminUid, 'save_settings', 'site');
}

export async function savePlanDoc(
  plan: SubscriptionPlan,
  adminUid: string,
  _isNew: boolean
): Promise<void> {
  const { id, ...rest } = plan;
  await setDoc(doc(db, 'plans', id), rest);
  await logAdminAction(adminUid, 'save_plan', id);
}

export async function deletePlanDoc(planId: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'plans', planId));
  await logAdminAction(adminUid, 'delete_plan', planId);
}

export async function saveCustomPageDoc(
  page: CustomPage,
  adminUid: string,
  _isNew: boolean
): Promise<void> {
  const { id, ...rest } = page;
  await setDoc(doc(db, 'pages', id), rest);
  await logAdminAction(adminUid, 'save_page', id);
}

export async function deleteCustomPageDoc(pageId: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'pages', pageId));
  await logAdminAction(adminUid, 'delete_page', pageId);
}

export async function updateContactMessageStatus(
  msgId: string,
  status: 'unread' | 'read' | 'archived' | 'resolved',
  adminUid: string
): Promise<void> {
  const safeStatus = status === 'resolved' ? 'archived' : status;
  await updateDoc(doc(db, 'messages', msgId), { status: safeStatus });
  await logAdminAction(adminUid, 'update_message_status', msgId);
}

export async function deleteContactMessageDoc(msgId: string, adminUid: string): Promise<void> {
  await deleteDoc(doc(db, 'messages', msgId));
  await logAdminAction(adminUid, 'delete_message', msgId);
}

export async function seedCatalogToFirestore(adminUid: string): Promise<void> {
  const batch = writeBatch(db);
  for (const m of SEED_MOVIES) {
    const { id, ...rest } = m;
    batch.set(doc(db, 'movies', id), rest);
  }
  for (const g of SEED_GENRES) {
    const { id, ...rest } = g;
    batch.set(doc(db, 'genres', id), rest);
  }
  for (const b of SEED_BANNERS) {
    const { id, ...rest } = b;
    batch.set(doc(db, 'banners', id), rest);
  }
  for (const p of SEED_PLANS) {
    const { id, ...rest } = p;
    batch.set(doc(db, 'plans', id), rest);
  }
  for (const pg of SEED_PAGES) {
    const { id, ...rest } = pg;
    batch.set(doc(db, 'pages', id), rest);
  }
  await batch.commit();
  await logAdminAction(adminUid, 'seed_catalog', 'catalog');
}
