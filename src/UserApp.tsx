import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crown,
  Film,
  Globe,
  Home,
  Info,
  LogOut,
  Mail,
  Menu,
  Moon,
  Play,
  Search,
  ShieldCheck,
  Star,
  Sun,
  Tv,
  User as UserIcon,
  WifiOff,
  X,
} from 'lucide-react';
import {
  auth,
  buildUserFromAuth,
  cancelUserSubscription,
  clearUserHistory,
  createComment,
  createReportDoc,
  deleteCommentDoc,
  deleteCurrentUserAccount,
  fetchMovieComments,
  fetchPublishedCatalog,
  fetchPublishedPages,
  fetchSeriesEpisodes,
  fetchSiteSettings,
  fetchUserPersonalData,
  incrementMovieViews,
  isUserAdmin,
  mergeGuestDataOnFirstSignIn,
  registerWithEmail,
  removeUserHistoryItem,
  saveUserWatchHistory,
  sendResetPassword,
  signInWithEmail,
  signInWithGooglePopup,
  signOutUser,
  syncUserProfileOnLogin,
  toggleUserLike,
  toggleUserWatchlist,
  updateCurrentUserPassword,
  updateOwnUserProfile,
  uploadFileWithProgress,
} from './lib/firebase';
import {
  createPendingOrder,
  subscribeToPublishedPosts,
  subscribeToUserOrders,
} from './lib/ordersFirebase';
import {
  rateLibraryTitle,
  recordUnitCompletionBatch,
  subscribeToUserAchievements,
  subscribeToUserActivity,
  subscribeToUserLibrary,
  subscribeToUserProgress,
} from './lib/libraryFirebase';
import { DEFAULT_SITE_SETTINGS, SEED_COMMENTS, SEED_EPISODES, SEED_PAGES } from './data/seedCatalog';
import { DEFAULT_AD_SETTINGS } from './data/seedAds';
import { loadAds, trackAdEvent } from './lib/adsFirebase';
import {
  fetchUserAdUnlocks,
  readLocalAdUnlocks,
  readRecentUnlockTimestamps,
  saveUserAdUnlock,
  subscribeToCrossTabUnlocks,
} from './lib/unlocksFirebase';
import type {
  AchievementItem,
  AdGlobalSettings,
  AdUnlockRecord,
  BannerItem,
  BlogPostItem,
  CommentItem,
  CustomAdItem,
  CustomCollection,
  CustomPage,
  EpisodeItem,
  GenreItem,
  LibraryActivityItem,
  LibraryItem,
  MovieItem,
  NavIconName,
  OrderItem,
  OrderPaymentMethod,
  ReportType,
  SeriesEpisodeSummary,
  SiteSettings,
  SocialPlatform,
  SubscriptionPlan,
  TargetPageKey,
  TitleProgressItem,
  UserProfile,
  VastAdItem,
  WatchHistoryItem,
  WatchlistItem,
} from './types/streaming';
import {
  formatDuration,
  readWatchHistoryEnabled,
  sanitizeText,
  searchMovies,
  slugify,
  sortMovies,
  writeWatchHistoryEnabled,
} from './utils/catalog';
import { deriveSeriesAccessSummary } from './utils/access';
import { detectCurrentDevice } from './utils/adEngine';
import { getProgressUnitId, isEpisodeCompleted } from './utils/library';
import {
  buildLinearGradientCss,
  formatCopyrightText,
  isWithinSchedule,
  resolveTranslation,
} from './utils/customization';
import { applySiteCustomizationToDom } from './utils/themeDom';
import { ToastProvider, useToast } from './components/ui/Toast';
import { AccessBadges } from './components/user/AccessBadges';
import { AuthModal } from './components/user/AuthModal';
import { BlogView } from './components/user/BlogView';
import { BrowseView } from './components/user/BrowseView';
import { CustomAdSlot } from './components/user/CustomAdSlot';
import { CustomPageView } from './components/user/CustomPageView';
import { DetailsView } from './components/user/DetailsView';
import { LibraryDashboard } from './components/user/LibraryDashboard';
import { MovieCard, MovieCardSkeleton } from './components/user/MovieCard';
import { ProfileView } from './components/user/ProfileView';
import { AdSlot, CookieConsentBar, SitePopupOverlay } from './components/user/SiteOverlays';
import { SubscriptionsView } from './components/user/SubscriptionsView';
import { VideoPlayer } from './components/user/VideoPlayer';
import { WatchRecommendations } from './components/user/WatchRecommendations';
import { AnimeEntrance } from './components/user/AnimeEntrance';

interface RouteState {
  page:
    | 'home'
    | 'dashboard'
    | 'auth'
    | 'movies'
    | 'series'
    | 'genre'
    | 'search'
    | 'movie'
    | 'watch'
    | 'mylist'
    | 'plans'
    | 'blog'
    | 'profile'
    | 'page'
    | 'notfound';
  param?: string;
  seasonNum?: number;
  episodeId?: string;
  query?: string;
}

function parseHashRoute(hash: string): RouteState {
  const raw = (hash || '#/home').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const searchParams = new URLSearchParams(queryPart || '');

  if (parts.length === 0 || parts[0] === 'home') return { page: 'home' };
  if (parts[0] === 'dashboard') return { page: 'dashboard' };
  if (parts[0] === 'auth' || parts[0] === 'signin' || parts[0] === 'login') return { page: 'auth' };
  if (parts[0] === 'movies') return { page: 'movies' };
  if (parts[0] === 'series') return { page: 'series' };
  if (parts[0] === 'mylist') return { page: 'mylist' };
  if (parts[0] === 'plans' || parts[0] === 'subscriptions') {
    return { page: 'plans', param: searchParams.get('plan') ?? undefined };
  }
  if (parts[0] === 'blog') return { page: 'blog', param: parts[1] };
  if (parts[0] === 'profile') return { page: 'profile' };
  if (parts[0] === 'search') return { page: 'search', query: searchParams.get('q') ?? '' };
  if (parts[0] === 'genre') return { page: 'genre', param: parts[1] ?? 'all' };
  if (parts[0] === 'movie' && parts[1]) return { page: 'movie', param: parts[1] };
  if (parts[0] === 'page' && parts[1]) return { page: 'page', param: parts[1] };
  if (parts[0] === 'watch' && parts[1]) {
    return {
      page: 'watch',
      param: parts[1],
      seasonNum: parts[2] ? Number(parts[2]) : undefined,
      episodeId: parts[3],
    };
  }
  return { page: 'notfound' };
}

function parseLocationRoute(): RouteState {
  if (typeof window === 'undefined') return { page: 'home' };
  const rawHash = window.location.hash.replace(/^#\/?/, '');
  if (rawHash) {
    return parseHashRoute(window.location.hash);
  }
  const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (cleanPath === '/dashboard') return { page: 'dashboard' };
  if (cleanPath === '/auth' || cleanPath === '/signin' || cleanPath === '/login') {
    return { page: 'auth' };
  }
  return { page: 'home' };
}

function renderNavIcon(icon: NavIconName, className = 'h-4 w-4') {
  switch (icon) {
    case 'home':
      return <Home className={className} />;
    case 'film':
      return <Film className={className} />;
    case 'tv':
      return <Tv className={className} />;
    case 'bookmark':
      return <Bookmark className={className} />;
    case 'crown':
      return <Crown className={className} />;
    case 'search':
      return <Search className={className} />;
    case 'user':
      return <UserIcon className={className} />;
    case 'compass':
      return <Compass className={className} />;
    case 'star':
      return <Star className={className} />;
    case 'info':
      return <Info className={className} />;
    case 'mail':
      return <Mail className={className} />;
    default:
      return <Home className={className} />;
  }
}

function renderSocialBadge(platform: SocialPlatform): string {
  switch (platform) {
    case 'instagram':
      return 'IG';
    case 'youtube':
      return 'YT';
    case 'telegram':
      return 'TG';
    case 'x':
      return 'X';
    case 'facebook':
      return 'FB';
    case 'whatsapp':
      return 'WA';
  }
}

function HorizontalRow({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.78), behavior: 'smooth' });
  };

  return (
    <section className="relative">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
        <div className="flex items-center gap-2">
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="text-xs font-semibold text-zinc-500 transition-colors hover:text-[var(--kv-accent,#e50914)] dark:text-zinc-400"
            >
              {actionLabel}
            </button>
          )}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label={`Scroll ${title} left`}
              className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#14141c] dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label={`Scroll ${title} right`}
              className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-[#14141c] dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="kv-row-scroll flex gap-4 overflow-x-auto pb-2"
      >
        {children}
      </div>
    </section>
  );
}

function UserPanelShell() {
  const { notify } = useToast();
  const [route, setRoute] = useState<RouteState>(() => parseLocationRoute());
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [genres, setGenres] = useState<GenreItem[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [publishedPages, setPublishedPages] = useState<CustomPage[]>(SEED_PAGES);
  const [customAds, setCustomAds] = useState<CustomAdItem[]>([]);
  const [vastAds, setVastAds] = useState<VastAdItem[]>([]);
  const [adSettings, setAdSettings] = useState<AdGlobalSettings>(DEFAULT_AD_SETTINGS);
  const [catalogLoading, setCatalogLoading] = useState(true);

  const [language, setLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem('kv_lang') || DEFAULT_SITE_SETTINGS.i18n?.defaultLanguage || 'en';
    } catch {
      return 'en';
    }
  });
  const [scrolled, setScrolled] = useState(false);

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(() => {
    const h = window.location.hash.replace(/^#\/?/, '').split('/')[0];
    const p = window.location.pathname.replace(/\/+$/, '') || '/';
    return (
      h === 'signin' ||
      h === 'login' ||
      h === 'auth' ||
      p === '/auth' ||
      p === '/signin' ||
      p === '/login'
    );
  });
  const [showEntrance, setShowEntrance] = useState(() => {
    try {
      const h = window.location.hash.replace(/^#\/?/, '').split('/')[0];
      const p = window.location.pathname.replace(/\/+$/, '') || '/';
      if (
        h === 'signin' ||
        h === 'login' ||
        h === 'auth' ||
        h === 'dashboard' ||
        h === 'admin' ||
        p === '/auth' ||
        p === '/signin' ||
        p === '/login' ||
        p === '/dashboard'
      ) {
        return false;
      }
      return sessionStorage.getItem('kv_intro_seen') !== '1';
    } catch {
      return true;
    }
  });

  // Personal state (synced with Firestore when signed in, mirrored in localStorage)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('kv_guest_watchlist') || '[]');
    } catch {
      return [];
    }
  });
  const [history, setHistory] = useState<WatchHistoryItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('kv_guest_history') || '[]');
    } catch {
      return [];
    }
  });
  const [historyEnabled, setHistoryEnabled] = useState<boolean>(() =>
    readWatchHistoryEnabled(null)
  );
  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('kv_guest_ratings') || '{}');
    } catch {
      return {};
    }
  });
  const [likes, setLikes] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('kv_guest_likes') || '[]');
    } catch {
      return [];
    }
  });

  // Active details/watch state
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [episodesBySeries, setEpisodesBySeries] = useState<Record<string, EpisodeItem[]>>(() => ({
    ...SEED_EPISODES,
  }));
  const [comments, setComments] = useState<CommentItem[]>([]);
  const viewedSessionRef = useRef<Set<string>>(new Set());

  // My Library Dashboard real-time Firestore state (signed-in users)
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, TitleProgressItem>>({});
  const [libraryActivity, setLibraryActivity] = useState<LibraryActivityItem[]>([]);
  const [achievements, setAchievements] = useState<AchievementItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [userOrders, setUserOrders] = useState<OrderItem[]>([]);
  const [publishedPosts, setPublishedPosts] = useState<BlogPostItem[]>([]);
  const completedUnitsSessionRef = useRef<Set<string>>(new Set());
  const moviesMapRef = useRef<Record<string, MovieItem>>({});
  const personalFetchedUidRef = useRef<string | null>(null);

  // Ad-unlocks & cross-tab sync + responsive mobile flag
  const [adUnlocks, setAdUnlocks] = useState<Record<string, AdUnlockRecord>>(() =>
    readLocalAdUnlocks()
  );
  const [unlockTimestamps, setUnlockTimestamps] = useState<number[]>(() =>
    readRecentUnlockTimestamps()
  );
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  // UI chrome state
  const [heroIndex, setHeroIndex] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [genresMenuOpen, setGenresMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    return subscribeToCrossTabUnlocks((nextMap, nextTs) => {
      setAdUnlocks(nextMap);
      setUnlockTimestamps(nextTs);
    });
  }, []);

  const t = useCallback(
    (key: string, fallback: string) => resolveTranslation(settings.i18n, language, key, fallback),
    [settings.i18n, language]
  );

  // Sync theme to DOM & localStorage
  const toggleTheme = () => {
    if (settings.theme?.allowUserThemeToggle === false) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('kv_theme', next);
    } catch {
      // Ignore storage failures
    }
  };

  // Honor theme defaultMode when settings load or toggle is disabled
  useEffect(() => {
    const mode = settings.theme?.defaultMode;
    if (!mode) return;
    let userStored: string | null = null;
    try {
      userStored = localStorage.getItem('kv_theme');
    } catch {}
    if (settings.theme?.allowUserThemeToggle === false || !userStored) {
      const resolved: 'dark' | 'light' =
        mode === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : mode;
      setTheme(resolved);
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    }
  }, [settings.theme?.defaultMode, settings.theme?.allowUserThemeToggle]);

  // Track window scroll for transparent-to-solid navbar
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Listen to hash/path routing & online status
  useEffect(() => {
    const checkRouteActions = () => {
      const firstSegment = window.location.hash.replace(/^#\/?/, '').split('/')[0];
      const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
      if (firstSegment === 'admin') {
        window.location.href = '/admin.html';
        return;
      }
      if (
        firstSegment === 'signin' ||
        firstSegment === 'login' ||
        firstSegment === 'auth' ||
        (!window.location.hash && (cleanPath === '/auth' || cleanPath === '/signin' || cleanPath === '/login'))
      ) {
        setAuthModalOpen(true);
      }
    };
    checkRouteActions();

    const onRouteChange = () => {
      checkRouteActions();
      setRoute(parseLocationRoute());
      setMobileMenuOpen(false);
      setGenresMenuOpen(false);
      setProfileMenuOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Debounce live search (300ms)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Initial catalog, custom pages & settings load (Auth-only mode: in-memory catalog defaults)
  useEffect(() => {
    let active = true;
    (async () => {
      setCatalogLoading(true);
      try {
        const [siteCfg, catalog, pagesList, adsBundle] = await Promise.all([
          fetchSiteSettings(),
          fetchPublishedCatalog(60),
          fetchPublishedPages(),
          loadAds(),
        ]);
        if (!active) return;
        setSettings(siteCfg);
        setMovies(catalog.movies);
        setGenres(catalog.genres);
        setBanners(catalog.banners);
        setPlans(catalog.plans);
        setPublishedPages(pagesList);
        setCustomAds(adsBundle.customAds);
        setVastAds(adsBundle.vastAds);
        setAdSettings(adsBundle.adSettings);
        try {
          if (!localStorage.getItem('kv_lang') && siteCfg.i18n?.defaultLanguage) {
            setLanguage(siteCfg.i18n.defaultLanguage);
          }
        } catch {}
      } finally {
        if (active) setCatalogLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const goToDashboard = useCallback((replace = false) => {
    if (typeof window !== 'undefined') {
      if (replace) {
        window.history.replaceState(null, '', '/dashboard');
      } else {
        window.history.pushState(null, '', '/dashboard');
      }
    }
    setAuthModalOpen(false);
    setRoute({ page: 'dashboard' });
  }, []);

  const goToAuth = useCallback((replace = false) => {
    if (typeof window !== 'undefined') {
      if (replace) {
        window.history.replaceState(null, '', '/auth');
      } else {
        window.history.pushState(null, '', '/auth');
      }
    }
    setRoute({ page: 'auth' });
    setAuthModalOpen(true);
  }, []);

  const handleLogout = useCallback(async () => {
    await signOutUser();
    setProfileMenuOpen(false);
    goToAuth(false);
  }, [goToAuth]);

  // Firebase Authentication session listener, Firestore profile sync & route guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);

      const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
      const hashFirst = window.location.hash.replace(/^#\/?/, '').split('/')[0];

      if (!u) {
        setProfile(null);
        setHistoryEnabled(readWatchHistoryEnabled(null));
        setLibrary([]);
        setProgressMap({});
        setLibraryActivity([]);
        setAchievements([]);
        setUserOrders([]);
        setLibraryLoading(false);
        completedUnitsSessionRef.current.clear();
        personalFetchedUidRef.current = null;
        try {
          setWatchlist(JSON.parse(localStorage.getItem('kv_guest_watchlist') || '[]'));
          setHistory(JSON.parse(localStorage.getItem('kv_guest_history') || '[]'));
          setRatings(JSON.parse(localStorage.getItem('kv_guest_ratings') || '{}'));
          setLikes(JSON.parse(localStorage.getItem('kv_guest_likes') || '[]'));
        } catch {}
        setAdUnlocks(readLocalAdUnlocks());
        if (cleanPath === '/dashboard' || hashFirst === 'dashboard') {
          goToAuth(true);
        }
        return;
      }

      setHistoryEnabled(readWatchHistoryEnabled(u.uid));
      setProfile(buildUserFromAuth(u));
      setAuthModalOpen(false);

      void (async () => {
        try {
          const synced = await syncUserProfileOnLogin(u);
          setProfile(synced);
        } catch {
          // Keep Auth-derived session profile when Firestore is unreachable
        }
        try {
          const personal = await fetchUserPersonalData(u.uid);
          personalFetchedUidRef.current = u.uid;
          setWatchlist(personal.watchlist);
          setHistory(personal.history);
          setRatings(personal.ratings);
          setLikes(personal.likes);
        } catch {
          // Keep existing state if Firestore read fails
        }
        try {
          const remoteUnlocks = await fetchUserAdUnlocks(u.uid);
          setAdUnlocks(remoteUnlocks);
        } catch {}
      })();

      const isOnAuthOrRoot =
        cleanPath === '/auth' ||
        cleanPath === '/signin' ||
        cleanPath === '/login' ||
        hashFirst === 'auth' ||
        hashFirst === 'signin' ||
        hashFirst === 'login' ||
        (cleanPath === '/' && (!hashFirst || hashFirst === 'home'));

      if (isOnAuthOrRoot) {
        goToDashboard(true);
      }
    });
    return () => unsub();
  }, [goToAuth, goToDashboard]);

  // One-time guest watchlist & history merge into Firestore after catalog + auth are ready
  useEffect(() => {
    if (!authUser || catalogLoading) return;
    let active = true;
    (async () => {
      try {
        const remote =
          personalFetchedUidRef.current === authUser.uid
            ? { watchlist, history }
            : await fetchUserPersonalData(authUser.uid);
        if (!active) return;
        const result = await mergeGuestDataOnFirstSignIn(
          authUser.uid,
          moviesMapRef.current,
          remote
        );
        if (!active || !result.merged) return;
        setWatchlist(result.watchlist);
        setHistory(result.history);
        notify('Synced your saved watchlist and history to your account.', 'info');
      } catch {
        // Non-fatal if offline or rules not yet deployed
      }
    })();
    return () => {
      active = false;
    };
    // Only trigger when user ID or initial catalog readiness changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid, catalogLoading]);

  // Real-time onSnapshot subscriptions for library, progress, and achievements
  useEffect(() => {
    if (!authUser) return;
    setLibraryLoading(true);
    let libLoaded = false;
    let progLoaded = false;
    const markReady = () => {
      if (libLoaded && progLoaded) {
        setLibraryLoading(false);
      }
    };

    const unsubLib = subscribeToUserLibrary(
      authUser.uid,
      (items) => {
        libLoaded = true;
        setLibrary(items);
        markReady();
      },
      () => {
        libLoaded = true;
        setLibraryLoading(false);
        notify('Unable to sync library from Firestore.', 'error');
      }
    );

    const unsubProg = subscribeToUserProgress(
      authUser.uid,
      (map) => {
        progLoaded = true;
        setProgressMap(map);
        markReady();
      },
      () => {
        progLoaded = true;
        setLibraryLoading(false);
      }
    );

    const unsubAch = subscribeToUserAchievements(
      authUser.uid,
      (items) => {
        setAchievements(items);
      },
      () => undefined
    );

    return () => {
      unsubLib();
      unsubProg();
      unsubAch();
    };
  }, [authUser?.uid, notify]);

  // Real-time onSnapshot subscription for user watch activity (used for hours-watched stats)
  useEffect(() => {
    if (!authUser) return;
    const unsub = subscribeToUserActivity(
      authUser.uid,
      null,
      ({ items }) => {
        setLibraryActivity(items);
      },
      () => undefined
    );
    return () => unsub();
  }, [authUser?.uid]);

  // Real-time orders subscription for signed-in user & published blog posts for everyone
  useEffect(() => {
    const unsubPosts = subscribeToPublishedPosts(
      (posts) => setPublishedPosts(posts),
      () => undefined
    );
    return () => unsubPosts();
  }, []);

  useEffect(() => {
    if (!authUser) {
      setUserOrders([]);
      return;
    }
    const unsubOrders = subscribeToUserOrders(
      authUser.uid,
      (orders) => setUserOrders(orders),
      () => undefined
    );
    return () => unsubOrders();
  }, [authUser?.uid]);

  // Enforce route guard whenever route or auth state changes
  useEffect(() => {
    if (!authReady) return;
    if (!authUser && route.page === 'dashboard') {
      goToAuth(true);
    } else if (authUser && route.page === 'auth') {
      goToDashboard(true);
    }
  }, [authReady, authUser, route.page, goToAuth, goToDashboard]);

  // Navigate helper
  const navigate = useCallback((hash: string) => {
    window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
  }, []);

  const navigateHref = useCallback(
    (href: string) => {
      const target = (href || '').trim();
      if (!target) return;
      if (target.startsWith('#')) {
        window.location.hash = target;
      } else if (target.startsWith('/')) {
        window.location.href = target;
      } else if (/^https?:\/\//i.test(target) || /^mailto:/i.test(target)) {
        window.location.assign(target);
      } else {
        navigate(`/${target.replace(/^\/+/, '')}`);
      }
    },
    [navigate]
  );

  const moviesMap = useMemo(() => {
    const map: Record<string, MovieItem> = {};
    movies.forEach((m) => {
      map[m.id] = m;
    });
    moviesMapRef.current = map;
    return map;
  }, [movies]);

  const watchlistIds = useMemo(() => new Set(watchlist.map((w) => w.movieId)), [watchlist]);
  const historyMap = useMemo(() => {
    if (!historyEnabled) return {};
    const map: Record<string, WatchHistoryItem> = {};
    history.forEach((h) => {
      map[h.movieId] = h;
    });
    return map;
  }, [history, historyEnabled]);

  // Resolve current movie for details or watch route
  const activeMovie = useMemo(() => {
    if (!route.param) return undefined;
    return movies.find((m) => m.slug === route.param || m.id === route.param);
  }, [movies, route.param]);

  // Resolve current custom page
  const activeCustomPage = useMemo(() => {
    if (route.page !== 'page' || !route.param) return null;
    return publishedPages.find((p) => p.slug === route.param || p.id === route.param) ?? null;
  }, [publishedPages, route.page, route.param]);

  // Apply 11-tab theme CSS vars, fonts, SEO meta tags, favicon, manifest & custom code
  useEffect(() => {
    const routeTitleMap: Record<RouteState['page'], string> = {
      home: settings.siteName,
      dashboard: 'Dashboard',
      auth: 'Sign In',
      movies: t('movies', 'Movies'),
      series: t('series', 'Series'),
      genre: genres.find((g) => g.slug === route.param)?.name || 'Genre',
      search: route.query ? `Search: ${route.query}` : t('search', 'Search'),
      movie: activeMovie?.title || 'Title',
      watch: activeMovie ? `Watch ${activeMovie.title}` : 'Watch',
      mylist: t('mylist', 'My List'),
      plans: t('plans', 'Plans'),
      blog: 'Blog',
      profile: 'Profile',
      page: activeCustomPage?.title || 'Page',
      notfound: 'Not Found',
    };
    applySiteCustomizationToDom(settings, {
      pageTitle: routeTitleMap[route.page],
      activeMovie: route.page === 'movie' || route.page === 'watch' ? activeMovie ?? null : null,
    });
  }, [settings, route, activeMovie, activeCustomPage, genres, t]);

  const seriesSummariesMap = useMemo(() => {
    const map: Record<string, SeriesEpisodeSummary> = {};
    movies.forEach((m) => {
      if (m.type === 'series') {
        const eps = episodesBySeries[m.id] ?? [];
        if (eps.length > 0) {
          map[m.id] = deriveSeriesAccessSummary(m, eps, adSettings);
        }
      }
    });
    return map;
  }, [movies, episodesBySeries, adSettings]);

  // Fetch episodes and comments when viewing movie or watch page
  useEffect(() => {
    if (!activeMovie || (route.page !== 'movie' && route.page !== 'watch')) return;
    let mounted = true;
    (async () => {
      const [eps, cmts] = await Promise.all([
        activeMovie.type === 'series' ? fetchSeriesEpisodes(activeMovie.id) : Promise.resolve([]),
        route.page === 'movie' ? fetchMovieComments(activeMovie.id) : Promise.resolve([]),
      ]);
      if (!mounted) return;
      setEpisodes(eps);
      if (activeMovie.type === 'series' && eps.length > 0) {
        setEpisodesBySeries((prev) => ({ ...prev, [activeMovie.id]: eps }));
      }
      if (route.page === 'movie') {
        setComments(cmts.length > 0 ? cmts : SEED_COMMENTS.filter((c) => c.movieId === activeMovie.id));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeMovie?.id, activeMovie?.type, route.page]);

  // Increment view count once per session when entering watch page
  useEffect(() => {
    if (route.page === 'watch' && activeMovie && !viewedSessionRef.current.has(activeMovie.id)) {
      viewedSessionRef.current.add(activeMovie.id);
      setMovies((prev) =>
        prev.map((m) => (m.id === activeMovie.id ? { ...m, views: m.views + 1 } : m))
      );
      incrementMovieViews(activeMovie.id);
    }
  }, [route.page, activeMovie?.id]);

  // Hero slides
  const heroSlides = useMemo(() => {
    const maxSlides = Math.max(1, settings.homeLayout?.heroMaxSlides ?? 5);
    const activeBanners = banners
      .filter((b) => b.isActive)
      .map((b) => ({ banner: b, movie: moviesMap[b.movieId] }))
      .filter((x): x is { banner: BannerItem; movie: MovieItem } => Boolean(x.movie));
    if (activeBanners.length > 0) return activeBanners.slice(0, maxSlides);
    return movies.slice(0, maxSlides).map((m, idx) => ({
      banner: { id: `auto-${m.id}`, movieId: m.id, imageUrl: m.bannerUrl || m.posterUrl, order: idx, isActive: true },
      movie: m,
    }));
  }, [banners, moviesMap, movies, settings.homeLayout?.heroMaxSlides]);

  // Hero auto-advance
  useEffect(() => {
    if (route.page !== 'home' || heroSlides.length <= 1) return;
    if (settings.homeLayout?.heroAutoplay === false) return;
    const ms = Math.max(3, settings.homeLayout?.heroIntervalSec ?? 6) * 1000;
    const tmr = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroSlides.length);
    }, ms);
    return () => window.clearInterval(tmr);
  }, [route.page, heroSlides.length, settings.homeLayout?.heroAutoplay, settings.homeLayout?.heroIntervalSec]);

  // Live search suggestions
  const suggestions = useMemo(() => {
    if (!debouncedQuery) return [];
    return searchMovies(movies, debouncedQuery).slice(0, 6);
  }, [movies, debouncedQuery]);

  // Action Handlers
  const handleSelectMovie = (movie: MovieItem) => {
    navigate(`/movie/${movie.slug}`);
  };

  const handlePlayMovie = (movie: MovieItem, ep?: EpisodeItem) => {
    if (ep) {
      navigate(`/watch/${movie.id}/${ep.seasonNumber}/${ep.id}`);
    } else {
      navigate(`/watch/${movie.id}`);
    }
  };

  const handleToggleWatchlist = async (movie: MovieItem) => {
    const exists = watchlistIds.has(movie.id);
    const nextList = exists
      ? watchlist.filter((w) => w.movieId !== movie.id)
      : [{ movieId: movie.id, addedAt: new Date().toISOString() }, ...watchlist];
    setWatchlist(nextList);
    try {
      localStorage.setItem('kv_guest_watchlist', JSON.stringify(nextList));
    } catch {}

    if (authUser) {
      try {
        await toggleUserWatchlist(authUser.uid, movie.id, !exists);
      } catch {
        // Already updated locally
      }
    }
    notify(exists ? `Removed "${movie.title}" from My List` : `Added "${movie.title}" to My List`, 'success');
  };

  const handleToggleHistoryEnabled = useCallback(
    (enabled: boolean) => {
      setHistoryEnabled(enabled);
      writeWatchHistoryEnabled(enabled, authUser?.uid ?? null);
      notify(enabled ? 'Watch history turned on' : 'Watch history turned off', 'info');
    },
    [authUser?.uid, notify]
  );

  const handleSaveProgress = useCallback(
    async (progressSeconds: number, durationSeconds: number, episode?: EpisodeItem | null) => {
      if (!activeMovie) return;
      if (historyEnabled) {
        const entry: WatchHistoryItem = {
          movieId: activeMovie.id,
          progressSeconds: Math.round(progressSeconds),
          durationSeconds: Math.max(1, Math.round(durationSeconds)),
          seasonId: episode?.seasonId,
          episodeId: episode?.id,
          updatedAt: new Date().toISOString(),
        };
        setHistory((prev) => {
          const filtered = prev.filter((h) => h.movieId !== activeMovie.id);
          const next = [entry, ...filtered];
          try {
            localStorage.setItem('kv_guest_history', JSON.stringify(next));
          } catch {}
          return next;
        });
        if (authUser) {
          await saveUserWatchHistory(authUser.uid, entry).catch(() => undefined);
        }
      }
      if (!authUser) return;

      if (isEpisodeCompleted(progressSeconds, durationSeconds)) {
        const unitId = getProgressUnitId(activeMovie, episode);
        const sessionKey = `${activeMovie.id}:${unitId}`;
        const existingProgress = progressMap[activeMovie.id];
        const alreadySaved = existingProgress?.completedEpisodeIds.includes(unitId);

        if (!alreadySaved && !completedUnitsSessionRef.current.has(sessionKey)) {
          completedUnitsSessionRef.current.add(sessionKey);
          const totalEps =
            activeMovie.type === 'series'
              ? Math.max(episodes.length, (episodesBySeries[activeMovie.id] ?? []).length, 1)
              : 1;
          try {
            const res = await recordUnitCompletionBatch({
              uid: authUser.uid,
              movie: activeMovie,
              episode,
              totalEpisodesCount: totalEps,
              durationSeconds,
              prevProgress: existingProgress,
              existingLibraryItem: library.find((l) => l.titleId === activeMovie.id),
            });
            if (res.achievementIssued) {
              notify(`Completed "${activeMovie.title}"! Achievement unlocked.`, 'success');
            } else {
              notify(`Progress saved for "${activeMovie.title}".`, 'success');
            }
          } catch {
            completedUnitsSessionRef.current.delete(sessionKey);
            notify('Could not save completion progress.', 'error');
          }
        }
      }
    },
    [activeMovie, authUser, episodes.length, episodesBySeries, historyEnabled, library, notify, progressMap]
  );

  const handleToggleLike = async (movie: MovieItem) => {
    const liked = likes.includes(movie.id);
    const nextLikes = liked ? likes.filter((id) => id !== movie.id) : [...likes, movie.id];
    setLikes(nextLikes);
    try {
      localStorage.setItem('kv_guest_likes', JSON.stringify(nextLikes));
    } catch {}
    setMovies((prev) =>
      prev.map((m) =>
        m.id === movie.id ? { ...m, likesCount: Math.max(0, m.likesCount + (liked ? -1 : 1)) } : m
      )
    );
    if (authUser) {
      await toggleUserLike(authUser.uid, movie.id, !liked).catch(() => undefined);
    }
    notify(liked ? 'Removed like' : `Liked "${movie.title}"`, 'success');
  };

  const handleRate = async (movie: MovieItem, value: number) => {
    const prevRating = ratings[movie.id];
    const nextRatings = { ...ratings, [movie.id]: value };
    setRatings(nextRatings);
    try {
      localStorage.setItem('kv_guest_ratings', JSON.stringify(nextRatings));
    } catch {}
    if (authUser) {
      try {
        await rateLibraryTitle(authUser.uid, movie, value);
      } catch {
        setRatings((curr) => {
          const rollback = { ...curr };
          if (typeof prevRating === 'number') {
            rollback[movie.id] = prevRating;
          } else {
            delete rollback[movie.id];
          }
          return rollback;
        });
        notify('Could not save rating to Firestore.', 'error');
        return;
      }
    }
    notify(`Rated "${movie.title}" ${value}/5 stars`, 'success');
  };

  const handleAddComment = async (movieId: string, text: string) => {
    if (!profile) {
      setAuthModalOpen(true);
      return;
    }
    const clean = sanitizeText(text, 1000);
    const payload: Omit<CommentItem, 'id'> = {
      movieId,
      uid: profile.uid,
      userName: profile.displayName,
      userPhoto: profile.photoURL,
      text: clean,
      createdAt: new Date().toISOString(),
      isHidden: false,
    };
    const created = await createComment(payload);
    setComments((prev) => [created, ...prev]);
    notify('Comment posted', 'success');
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteCommentDoc(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    notify('Comment deleted', 'success');
  };

  const handleSubmitReport = async (movieId: string, type: ReportType, message: string) => {
    if (!profile) {
      setAuthModalOpen(true);
      return;
    }
    await createReportDoc({ movieId, uid: profile.uid, type, message });
    notify('Report submitted. Thank you for helping keep links healthy.', 'success');
  };

  const handleShare = async (movie: MovieItem) => {
    const url = `${window.location.origin}/#/movie/${movie.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: movie.title, text: movie.description, url });
      } else {
        await navigator.clipboard.writeText(url);
        notify('Link copied to clipboard', 'success');
      }
    } catch {
      notify('Link ready to share', 'info');
    }
  };

  const handleGrantAdUnlock = useCallback(
    async (record: AdUnlockRecord) => {
      const nextMap = await saveUserAdUnlock(record, authUser?.uid);
      setAdUnlocks(nextMap);
      setUnlockTimestamps(readRecentUnlockTimestamps());
      notify('Episode unlocked! Starting playback.', 'success');
    },
    [authUser?.uid, notify]
  );

  const handleRequestSubscription = async (
    plan: SubscriptionPlan,
    paymentMethod: OrderPaymentMethod,
    reference?: string
  ) => {
    if (!authUser || !profile) {
      setAuthModalOpen(true);
      return;
    }
    try {
      await createPendingOrder({
        user: profile,
        plan,
        paymentMethod,
        reference,
      });
      trackAdEvent(
        {
          adId: plan.id,
          adKind: 'gate',
          event: 'subscribe_click',
          contentId: activeMovie?.id || 'plans',
          contentType: activeMovie?.type === 'series' ? 'tvshow' : 'movie',
          placement: 'plans',
          uid: authUser.uid,
          device: detectCurrentDevice(),
        },
        adSettings.testMode
      );
      notify('Request sent, waiting for admin confirmation', 'success');
    } catch {
      notify(
        'Unable to submit subscription order. Ensure the selected plan is active.',
        'error'
      );
    }
  };

  const handleCancelSubscription = async () => {
    if (!authUser || !profile) return;
    try {
      await cancelUserSubscription(authUser.uid);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              plan: 'free',
              subscriptionPlanId: null,
              subscriptionPlanName: null,
              planExpiresAt: null,
            }
          : prev
      );
      notify('Subscription canceled. Switched back to Free tier.', 'info');
    } catch {
      notify('Could not update subscription status.', 'error');
    }
  };

  const handleFinishEntrance = useCallback(() => {
    setShowEntrance(false);
    try {
      sessionStorage.setItem('kv_intro_seen', '1');
    } catch {}
  }, []);

  if (!authReady && route.page === 'dashboard') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f] text-sm text-zinc-400">
        Verifying session...
      </div>
    );
  }

  // Banned screen
  if (profile?.status === 'banned') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f] px-4 text-white">
        <div className="max-w-md rounded-2xl border border-zinc-800 bg-[#14141c] p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-4 font-display text-2xl font-bold">Your account is suspended</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Access to {settings.siteName} has been restricted by an administrator.
          </p>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-6 rounded-lg border border-zinc-700 px-5 py-2 text-sm font-medium hover:bg-zinc-800"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Maintenance screen (bypassed for admins)
  if (settings.maintenanceMode && !isUserAdmin(profile, authUser)) {
    const maint = settings.maintenance;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f] px-4 text-white">
        <div className="max-w-md rounded-2xl border border-zinc-800 bg-[#14141c] p-8 text-center">
          {maint?.imageUrl ? (
            <img
              src={maint.imageUrl}
              alt="Maintenance"
              className="mx-auto mb-4 h-36 w-full rounded-xl object-cover"
            />
          ) : (
            <Film className="mx-auto h-10 w-10 text-[var(--kv-accent,#e50914)]" />
          )}
          <h1 className="mt-4 font-display text-2xl font-bold">Scheduled Maintenance</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {maint?.message ||
              `${settings.siteName} is undergoing a brief catalog upgrade. We will be back shortly.`}
          </p>
          {maint?.expectedReturnTime && (
            <p className="mt-3 text-xs font-semibold text-amber-400">
              Expected return: {maint.expectedReturnTime}
            </p>
          )}
          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className="mt-6 text-xs text-zinc-400 underline hover:text-white"
          >
            Administrator Sign In
          </button>
          <AuthModal
            open={authModalOpen}
            allowRegistration={false}
            allowSocialLogin={settings.featureFlags?.socialLogin !== false}
            onClose={() => setAuthModalOpen(false)}
            onGoogleLogin={async () => {
              await signInWithGooglePopup();
            }}
            onEmailLogin={async (e, p) => {
              await signInWithEmail(e, p);
            }}
            onEmailRegister={async () => undefined}
            onForgotPassword={sendResetPassword}
          />
        </div>
      </div>
    );
  }

  // Derived Home rows
  const continueWatchingMovies = historyEnabled
    ? history
        .map((h) => moviesMap[h.movieId])
        .filter((m): m is MovieItem => Boolean(m))
    : [];
  const trendingMovies = movies.filter((m) => m.isTrending);
  const featuredMovies = movies.filter((m) => m.isFeatured);
  const topRatedMovies = sortMovies(movies, 'rating');
  const recentMovies = sortMovies(movies, 'newest');
  const seriesMovies = movies.filter((m) => m.type === 'series');
  const upcomingMovies = movies.filter(
    (m) =>
      m.tags.some((tag) => tag.toLowerCase().includes('upcoming')) ||
      m.releaseYear >= new Date().getFullYear()
  );

  // Announcement visibility (schedule + page targeting)
  const ann = settings.announcement;
  const currentTargetPage: TargetPageKey =
    route.page === 'home' ||
    route.page === 'movies' ||
    route.page === 'series' ||
    route.page === 'plans' ||
    route.page === 'watch' ||
    route.page === 'page'
      ? route.page
      : 'all';
  const announcementMatchesPage =
    !ann?.targetPages ||
    ann.targetPages.length === 0 ||
    ann.targetPages.includes('all') ||
    ann.targetPages.includes(currentTargetPage);
  const showAnnouncement =
    Boolean(ann?.isActive && ann.text) &&
    !announcementDismissed &&
    isWithinSchedule(ann?.startAt, ann?.endAt) &&
    announcementMatchesPage;

  // Navigation & branding customization
  const navCfg = settings.navigation;
  const shapeCfg = settings.shape;
  const brandingCfg = settings.branding;
  const featureFlags = settings.featureFlags;
  const homeCfg = settings.homeLayout;
  const activeLogoUrl =
    theme === 'light' && brandingCfg?.logoLightUrl ? brandingCfg.logoLightUrl : settings.logoUrl;
  const logoCentered = brandingCfg?.logoPosition === 'center';

  const visibleMenuItems = (navCfg?.menuItems ?? []).filter((item) => {
    if (featureFlags?.premiumSection === false && item.href.includes('plans')) return false;
    if (featureFlags?.watchlist === false && item.href.includes('mylist')) return false;
    return true;
  });

  const navPositionClass = shapeCfg?.navbarSticky === false ? 'relative' : 'sticky top-0';
  const navStyleType = shapeCfg?.navbarStyle || 'glass';
  const navBgClass =
    navStyleType === 'solid'
      ? 'border-b border-zinc-200/80 bg-white dark:border-white/10 dark:bg-[#0b0b0f]'
      : navStyleType === 'transparent-to-solid'
      ? scrolled
        ? 'border-b border-zinc-200/80 bg-white/95 backdrop-blur-md dark:border-white/10 dark:bg-[#0b0b0f]/95'
        : 'border-b border-transparent bg-gradient-to-b from-black/70 to-transparent text-white'
      : 'border-b border-zinc-200/80 bg-white/80 dark:border-white/10 dark:bg-[#0b0b0f]/80';

  const availableLanguages = Object.keys(settings.i18n?.labels || { en: {} });

  // Watch page episode resolution
  const activeEpisode =
    route.page === 'watch' && activeMovie?.type === 'series'
      ? episodes.find((e) => e.id === route.episodeId) ||
        episodes.find((e) => e.seasonNumber === (route.seasonNum ?? 1)) ||
        episodes[0] ||
        null
      : null;

  const nextEpisode =
    activeEpisode && episodes.length > 0
      ? (() => {
          const idx = episodes.findIndex((e) => e.id === activeEpisode.id);
          return idx >= 0 && idx + 1 < episodes.length ? episodes[idx + 1] : null;
        })()
      : null;

  const myListMovies = movies.filter((m) => watchlistIds.has(m.id));

  const cardWidthClass =
    homeCfg?.cardSize === 'compact'
      ? 'w-32 sm:w-36'
      : homeCfg?.cardSize === 'large'
      ? 'w-48 sm:w-56'
      : 'w-40 sm:w-44';

  return (
    <div className="flex min-h-screen flex-col pb-16 md:pb-0">
      <AnimeEntrance
        open={showEntrance}
        siteName={settings.siteName}
        branding={brandingCfg}
        reducedMotion={Boolean(shapeCfg?.reducedMotion)}
        onComplete={handleFinishEntrance}
      />

      {/* Offline Banner */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white">
          <WifiOff className="h-3.5 w-3.5" />
          You are offline. Showing cached catalog data.
        </div>
      )}

      {/* Announcement Bar */}
      {showAnnouncement && ann && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-1.5 text-[11px] font-medium sm:px-6"
          style={{
            backgroundColor: ann.bgColor || 'var(--kv-accent,#e50914)',
            color: ann.textColor || '#ffffff',
          }}
        >
          <div className="w-4 shrink-0" />
          {ann.link ? (
            <a
              href={ann.link}
              onClick={(e) => {
                if (ann.link && !ann.link.startsWith('http')) {
                  e.preventDefault();
                  navigateHref(ann.link);
                }
              }}
              className="truncate text-center underline-offset-2 hover:underline"
            >
              {ann.text}
            </a>
          ) : (
            <p className="truncate text-center">{ann.text}</p>
          )}
          {ann.dismissible !== false ? (
            <button
              type="button"
              onClick={() => setAnnouncementDismissed(true)}
              aria-label="Dismiss announcement"
              className="shrink-0 rounded p-0.5 hover:bg-black/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}
        </div>
      )}

      {/* Customizable Top Navbar */}
      <header
        className={`${navPositionClass} z-50 transition-colors duration-200 ${navBgClass}`}
        style={{
          backdropFilter:
            navStyleType === 'glass' ? `blur(${shapeCfg?.navbarBlur ?? 12}px)` : undefined,
        }}
      >
        <div
          className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:gap-8 sm:px-6"
          style={{ minHeight: `${shapeCfg?.navbarHeight ?? 64}px` }}
        >
          {/* Zone 1: Brand Wordmark (+ Nav Links on left if centered logo) */}
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="rounded-lg p-1.5 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 md:hidden"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <a
              href="#/home"
              className={`flex items-center gap-2 font-display text-xl font-bold tracking-tight text-zinc-950 dark:text-white whitespace-nowrap shrink-0 ${
                logoCentered
                  ? 'md:absolute md:left-1/2 md:-translate-x-1/2'
                  : ''
              }`}
            >
              {activeLogoUrl ? (
                <img
                  src={activeLogoUrl}
                  alt={settings.siteName}
                  style={{ height: `${brandingCfg?.logoHeight ?? 28}px` }}
                  className="w-auto object-contain"
                />
              ) : (
                <span>{settings.siteName}</span>
              )}
            </a>
          </div>

          {/* Zone 2: Clean Text Nav Links */}
          <nav
            aria-label="Main navigation"
            className={`hidden items-center gap-5 text-sm font-medium text-zinc-600 dark:text-zinc-300 md:flex ${
              logoCentered ? 'mr-auto' : ''
            }`}
          >
            {visibleMenuItems.map((item) => {
              const translated =
                item.href === '#/home'
                  ? t('home', item.label)
                  : item.href === '#/movies'
                  ? t('movies', item.label)
                  : item.href === '#/series'
                  ? t('series', item.label)
                  : item.href === '#/mylist'
                  ? t('mylist', item.label)
                  : item.href === '#/plans'
                  ? t('plans', item.label)
                  : item.label;
              const isActive =
                (item.href === '#/home' && route.page === 'home') ||
                (item.href === '#/movies' && route.page === 'movies') ||
                (item.href === '#/series' && route.page === 'series') ||
                (item.href === '#/mylist' && route.page === 'mylist') ||
                (item.href === '#/plans' && route.page === 'plans') ||
                (item.href.startsWith('#/page/') &&
                  route.page === 'page' &&
                  item.href.endsWith(`/${route.param}`));

              return (
                <a
                  key={item.id}
                  href={item.href}
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener noreferrer' : undefined}
                  className={`transition-colors hover:text-zinc-950 dark:hover:text-white whitespace-nowrap shrink-0 ${
                    isActive ? 'font-semibold text-zinc-950 dark:text-white' : ''
                  }`}
                >
                  {translated}
                </a>
              );
            })}

            <div className="relative">
              <button
                type="button"
                onClick={() => setGenresMenuOpen((v) => !v)}
                aria-expanded={genresMenuOpen}
                className="inline-flex items-center gap-1 transition-colors hover:text-zinc-950 dark:hover:text-white whitespace-nowrap shrink-0"
              >
                {t('genres', 'Genres')}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {genresMenuOpen && (
                <div className="absolute left-0 top-full mt-2 w-48 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-[#14141c]">
                  {genres.map((g) => (
                    <a
                      key={g.id}
                      href={`#/genre/${g.slug}`}
                      className="block rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {g.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {/* Zone 3: Search, Language, Plans, Theme & Account */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {navCfg?.showSearchBar !== false && (
              <div className="relative hidden sm:block">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearchOpen(false);
                    navigate(`/search?q=${encodeURIComponent(searchInput.trim())}`);
                  }}
                >
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    value={searchInput}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => window.setTimeout(() => setSearchOpen(false), 180)}
                    onChange={(e) => {
                      setSearchInput(e.target.value);
                      setSearchOpen(true);
                    }}
                    placeholder={t('search', 'Search titles, cast...')}
                    aria-label="Search catalog"
                    className="kv-input-radius w-40 border border-zinc-200 bg-zinc-100/80 py-1.5 pl-8 pr-3 text-xs text-zinc-900 outline-none transition-all focus:w-52 focus:border-[var(--kv-accent,#e50914)] dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-100"
                  />
                </form>

                {searchOpen && suggestions.length > 0 && (
                  <div className="absolute right-0 top-full mt-2 w-72 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#14141c]">
                    {suggestions.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={() => handleSelectMovie(m)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <img
                          src={m.posterUrl}
                          alt={m.title}
                          className="h-10 w-7 shrink-0 rounded object-cover"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{m.title}</p>
                          <p className="text-[11px] text-zinc-500 tabular-nums">
                            {m.releaseYear} · {m.type}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {featureFlags?.premiumSection !== false && (
              <a
                href="#/plans"
                aria-label="Subscription Plans"
                title="Monthly Subscription Plans"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  route.page === 'plans'
                    ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400'
                }`}
              >
                <Crown className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[110px] truncate">
                  {profile?.plan === 'premium' && profile.subscriptionPlanName
                    ? profile.subscriptionPlanName
                    : t('plans', 'Plans')}
                </span>
              </a>
            )}

            {navCfg?.showLanguageSelector && availableLanguages.length > 0 && (
              <div className="relative hidden sm:flex items-center">
                <Globe className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-zinc-400" />
                <select
                  aria-label="Select language"
                  value={language}
                  onChange={(e) => {
                    const next = e.target.value;
                    setLanguage(next);
                    try {
                      localStorage.setItem('kv_lang', next);
                    } catch {}
                  }}
                  className="kv-input-radius border border-zinc-200 bg-transparent py-1 pl-7 pr-2 text-xs font-medium uppercase dark:border-zinc-800"
                >
                  {availableLanguages.map((code) => (
                    <option key={code} value={code} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-white">
                      {code.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {navCfg?.showThemeToggle !== false && settings.theme?.allowUserThemeToggle !== false && (
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            )}

            {navCfg?.showProfileMenu !== false && (
              profile ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProfileMenuOpen((v) => !v)}
                    aria-label="Account menu"
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--kv-accent,#e50914)] text-[10px] font-bold text-white">
                      {profile.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="hidden max-w-[90px] truncate sm:inline">
                      {profile.displayName}
                    </span>
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-[#14141c]">
                      <a
                        href="#/profile"
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <UserIcon className="h-3.5 w-3.5" />
                        Profile &amp; History
                      </a>
                      {featureFlags?.watchlist !== false && (
                        <a
                          href="#/mylist"
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                          {t('mylist', 'My List')}
                        </a>
                      )}
                      {isUserAdmin(profile, authUser) && (
                        <a
                          href="/admin.html"
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--kv-accent,#e50914)] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Admin Console
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="kv-primary-btn px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  {t('signIn', 'Sign In')}
                </button>
              )
            )}
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-[#0b0b0f] md:hidden">
            {navCfg?.showSearchBar !== false && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setMobileMenuOpen(false);
                  navigate(`/search?q=${encodeURIComponent(searchInput.trim())}`);
                }}
                className="mb-3"
              >
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t('search', 'Search titles, cast...')}
                  aria-label="Mobile search"
                  className="kv-input-radius w-full border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </form>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm font-medium">
              {visibleMenuItems
                .filter((item) => item.showOnMobile)
                .map((item) => (
                  <a
                    key={item.id}
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noopener noreferrer' : undefined}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {renderNavIcon(item.icon, 'h-4 w-4 text-zinc-400')}
                    <span>{item.label}</span>
                  </a>
                ))}
              {featureFlags?.premiumSection !== false && (
                <a
                  href="#/plans"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-amber-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Crown className="h-3.5 w-3.5" />
                  Subscription Plans
                </a>
              )}
              {genres.slice(0, 4).map((g) => (
                <a
                  key={g.id}
                  href={`#/genre/${g.slug}`}
                  className="rounded-lg px-3 py-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {g.name}
                </a>
              ))}
              {isUserAdmin(profile, authUser) && (
                <a
                  href="/admin.html"
                  className="col-span-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--kv-accent,#e50914)] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Admin Console
                </a>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <AdSlot config={settings.ads?.header} label="Header banner" />

        {(route.page === 'home' || (route.page === 'dashboard' && Boolean(authUser)) || route.page === 'auth') && (() => {
          const heroSection = homeCfg?.sections.find((s) => s.kind === 'hero');
          const showHero = heroSection ? heroSection.visible : true;
          const heroHeight = homeCfg?.heroHeightPx ?? 540;
          const overlayOpacity = homeCfg?.heroOverlayOpacity ?? 0.72;
          const useSlideTransition = homeCfg?.heroTransition === 'slide';
          const activeSlideIdx = heroSlides.length > 0 ? heroIndex % heroSlides.length : 0;

          const orderedSections = (homeCfg?.sections ?? []).filter(
            (s) => s.visible && s.kind !== 'hero'
          );

          const renderMovieRow = (key: string, title: string, list: MovieItem[], actionHash?: string) => {
            if (list.length === 0) return null;
            return (
              <HorizontalRow
                key={key}
                title={title}
                actionLabel={actionHash && homeCfg?.showSeeAllLink !== false ? 'See All' : undefined}
                onAction={actionHash && homeCfg?.showSeeAllLink !== false ? () => navigate(actionHash) : undefined}
              >
                {list.map((m) => (
                  <div key={m.id} className={`${cardWidthClass} shrink-0`}>
                    <MovieCard
                      movie={m}
                      inWatchlist={watchlistIds.has(m.id)}
                      history={historyMap[m.id]}
                      shape={shapeCfg}
                      homeLayout={homeCfg}
                      user={profile}
                      plans={plans}
                      unlocksMap={adUnlocks}
                      adSettings={adSettings}
                      episodesSummary={seriesSummariesMap[m.id]}
                      isMobile={isMobile}
                      onSelect={handleSelectMovie}
                      onPlay={handlePlayMovie}
                      onToggleWatchlist={handleToggleWatchlist}
                    />
                  </div>
                ))}
              </HorizontalRow>
            );
          };

          const resolveCollectionMovies = (col: CustomCollection): MovieItem[] => {
            const items = col.movieIds
              .map((id) => moviesMap[id])
              .filter((m): m is MovieItem => Boolean(m));
            if (col.sortOrder === 'newest') return sortMovies(items, 'newest');
            if (col.sortOrder === 'rating') return sortMovies(items, 'rating');
            if (col.sortOrder === 'views') return sortMovies(items, 'views');
            return items;
          };

          return (
            <div>
              {/* Hero Slider */}
              {showHero && (
                catalogLoading ? (
                  <div className="kv-skeleton w-full" style={{ height: `${heroHeight}px` }} />
                ) : heroSlides.length > 0 ? (
                  <section
                    aria-label="Featured spotlight"
                    className="relative w-full overflow-hidden bg-zinc-950"
                    style={{ height: `clamp(380px, 60vw, ${heroHeight}px)` }}
                  >
                    <div
                      className={useSlideTransition ? 'flex h-full transition-transform duration-500 ease-out' : 'relative h-full w-full'}
                      style={
                        useSlideTransition
                          ? {
                              width: `${heroSlides.length * 100}%`,
                              transform: `translateX(-${(activeSlideIdx * 100) / heroSlides.length}%)`,
                            }
                          : undefined
                      }
                    >
                      {heroSlides.map((slide, idx) => {
                        const active = idx === activeSlideIdx;
                        return (
                          <div
                            key={slide.banner.id}
                            className={
                              useSlideTransition
                                ? 'relative h-full shrink-0'
                                : `absolute inset-0 transition-opacity duration-500 ${
                                    active ? 'z-10 opacity-100' : 'pointer-events-none opacity-0'
                                  }`
                            }
                            style={useSlideTransition ? { width: `${100 / heroSlides.length}%` } : undefined}
                          >
                            <img
                              src={slide.banner.imageUrl || slide.movie.bannerUrl || slide.movie.posterUrl}
                              alt={slide.movie.title}
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                            <div
                              className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-[#0b0b0f]/55 to-black/25"
                              style={{ opacity: overlayOpacity }}
                            />
                            <div
                              className="absolute inset-0"
                              style={{
                                background: buildLinearGradientCss(settings.theme?.heroGradient),
                                opacity: Math.min(0.45, overlayOpacity * 0.45),
                              }}
                            />

                            <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pb-12 sm:px-6 sm:pb-16">
                              <div className="max-w-xl text-white">
                                <div className="flex items-center gap-2 text-xs font-medium text-zinc-300 tabular-nums">
                                  <span className="uppercase tracking-wider">{slide.movie.type}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{slide.movie.releaseYear}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{formatDuration(slide.movie.duration)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{slide.movie.genres.slice(0, 2).join(' · ')}</span>
                                  <AccessBadges
                                    movie={slide.movie}
                                    episodesSummary={seriesSummariesMap[slide.movie.id]}
                                    user={profile}
                                    plans={plans}
                                    unlocksMap={adUnlocks}
                                    adSettings={adSettings}
                                    isMobile={isMobile}
                                    size="md"
                                  />
                                </div>
                                <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-5xl">
                                  {slide.movie.title}
                                </h1>
                                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-zinc-200 sm:text-base">
                                  {slide.movie.description}
                                </p>
                                <div className="mt-6 flex flex-wrap items-center gap-3">
                                  {homeCfg?.heroShowPlayButton !== false && (
                                    <button
                                      type="button"
                                      onClick={() => handlePlayMovie(slide.movie)}
                                      className="kv-primary-btn inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold shadow-lg transition-opacity hover:opacity-90"
                                    >
                                      <Play className="h-4 w-4 fill-current" />
                                      {t('playNow', 'Play Now')}
                                    </button>
                                  )}
                                  {homeCfg?.heroShowMoreInfoButton !== false && (
                                    <button
                                      type="button"
                                      onClick={() => handleSelectMovie(slide.movie)}
                                      className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                                    >
                                      <Info className="h-4 w-4" />
                                      More Info
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {heroSlides.length > 1 && homeCfg?.heroShowArrows !== false && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setHeroIndex((i) => (i - 1 + heroSlides.length) % heroSlides.length)
                          }
                          aria-label="Previous spotlight"
                          className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/45 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/75 sm:flex"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setHeroIndex((i) => (i + 1) % heroSlides.length)}
                          aria-label="Next spotlight"
                          className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/45 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/75 sm:flex"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                      </>
                    )}

                    {heroSlides.length > 1 && homeCfg?.heroShowDots !== false && (
                      <div className="absolute bottom-5 right-6 z-20 flex items-center gap-2">
                        {heroSlides.map((s, idx) => (
                          <button
                            key={s.banner.id}
                            type="button"
                            onClick={() => setHeroIndex(idx)}
                            aria-label={`Show spotlight ${idx + 1}`}
                            className={`h-1.5 rounded-full transition-all ${
                              idx === activeSlideIdx
                                ? 'w-7 bg-white'
                                : 'w-2.5 bg-white/40 hover:bg-white/70'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ) : null
              )}

              {/* Dashboard on Signed-In /dashboard View */}
              {route.page === 'dashboard' && profile && (
                <LibraryDashboard
                  user={profile}
                  movies={movies}
                  moviesMap={moviesMap}
                  library={library}
                  watchlistIds={watchlistIds}
                  progressMap={progressMap}
                  activity={libraryActivity}
                  achievements={achievements}
                  ratings={ratings}
                  loading={libraryLoading}
                  onToggleWatchlist={handleToggleWatchlist}
                  onRateTitle={handleRate}
                  onPlayMovie={(m) => handlePlayMovie(m)}
                  onSelectMovie={handleSelectMovie}
                />
              )}

              {/* Banner Custom Ad Below Hero Spotlight */}
              {customAds.length > 0 && (
                <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
                  <CustomAdSlot
                    placement="banner"
                    customAds={customAds}
                    adSettings={adSettings}
                    user={profile}
                    contentType="all"
                  />
                </div>
              )}

              {/* Ordered Catalog Rows */}
              <div className="mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6">
                {catalogLoading ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <MovieCardSkeleton key={i} />
                    ))}
                  </div>
                ) : (
                  <>
                    {orderedSections.map((sec, idx) => {
                      let node: React.ReactNode = null;
                      if (sec.kind === 'continue') {
                        node = renderMovieRow(sec.id, sec.title, continueWatchingMovies);
                      } else if (sec.kind === 'trending') {
                        node = renderMovieRow(sec.id, sec.title, trendingMovies, '/movies');
                      } else if (sec.kind === 'featured') {
                        node = renderMovieRow(sec.id, sec.title, featuredMovies, '/movies');
                      } else if (sec.kind === 'top_rated') {
                        node = renderMovieRow(sec.id, sec.title, topRatedMovies, '/movies');
                      } else if (sec.kind === 'recent') {
                        node = renderMovieRow(sec.id, sec.title, recentMovies, '/movies');
                      } else if (sec.kind === 'series') {
                        node = renderMovieRow(sec.id, sec.title, seriesMovies, '/series');
                      } else if (sec.kind === 'upcoming') {
                        node = renderMovieRow(sec.id, sec.title, upcomingMovies);
                      } else if (sec.kind === 'genres') {
                        node = (
                          <React.Fragment key={sec.id}>
                            {genres.map((g) => {
                              const genreItems = movies.filter((m) =>
                                m.genres.some((mg) => slugify(mg) === g.slug || mg === g.name)
                              );
                              return renderMovieRow(`genre-${g.id}`, g.name, genreItems, `/genre/${g.slug}`);
                            })}
                          </React.Fragment>
                        );
                      } else if (sec.kind === 'collection') {
                        const col = (homeCfg?.customCollections ?? []).find(
                          (c) => c.id === sec.collectionId
                        );
                        if (col && isWithinSchedule(col.startAt, col.endAt)) {
                          node = renderMovieRow(
                            sec.id,
                            sec.title || col.title,
                            resolveCollectionMovies(col)
                          );
                        }
                      }

                      return (
                        <React.Fragment key={sec.id}>
                          {node}
                          {idx === 1 && (
                            <>
                              <CustomAdSlot
                                placement="home"
                                customAds={customAds}
                                adSettings={adSettings}
                                user={profile}
                                contentType="all"
                              />
                              <AdSlot config={settings.ads?.betweenRows} label="Catalog promotion" />
                            </>
                          )}
                          {idx === 4 && (
                            <CustomAdSlot
                              placement="home"
                              customAds={customAds}
                              adSettings={adSettings}
                              user={profile}
                              contentType="all"
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {route.page === 'movies' && (
          <BrowseView
            title={t('movies', 'Movies')}
            subtitle="Feature films, documentaries, and restorations."
            movies={movies}
            genres={genres}
            initialType="movie"
            loading={catalogLoading}
            watchlistIds={watchlistIds}
            historyMap={historyMap}
            shape={shapeCfg}
            homeLayout={homeCfg}
            user={profile}
            plans={plans}
            unlocksMap={adUnlocks}
            seriesSummariesMap={seriesSummariesMap}
            isMobile={isMobile}
            customAds={customAds}
            adSettings={adSettings}
            onSelectMovie={handleSelectMovie}
            onPlayMovie={handlePlayMovie}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {route.page === 'series' && (
          <BrowseView
            title={t('series', 'Series')}
            subtitle="Multi-season mysteries, dramas, and anthology adventures."
            movies={movies}
            genres={genres}
            initialType="series"
            loading={catalogLoading}
            watchlistIds={watchlistIds}
            historyMap={historyMap}
            shape={shapeCfg}
            homeLayout={homeCfg}
            user={profile}
            plans={plans}
            unlocksMap={adUnlocks}
            seriesSummariesMap={seriesSummariesMap}
            isMobile={isMobile}
            customAds={customAds}
            adSettings={adSettings}
            onSelectMovie={handleSelectMovie}
            onPlayMovie={handlePlayMovie}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {route.page === 'genre' && (
          <BrowseView
            title={
              genres.find((g) => g.slug === route.param)?.name ??
              (route.param ? route.param.toUpperCase() : 'Genres')
            }
            subtitle="Filtered by genre."
            movies={movies}
            genres={genres}
            initialGenre={route.param ?? 'all'}
            loading={catalogLoading}
            watchlistIds={watchlistIds}
            historyMap={historyMap}
            shape={shapeCfg}
            homeLayout={homeCfg}
            user={profile}
            plans={plans}
            unlocksMap={adUnlocks}
            seriesSummariesMap={seriesSummariesMap}
            isMobile={isMobile}
            customAds={customAds}
            adSettings={adSettings}
            onSelectMovie={handleSelectMovie}
            onPlayMovie={handlePlayMovie}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {route.page === 'search' && (
          <BrowseView
            title={`Search${route.query ? `: "${route.query}"` : ''}`}
            subtitle="Search across titles, cast, directors, genres, and tags."
            movies={movies}
            genres={genres}
            searchQuery={route.query ?? ''}
            loading={catalogLoading}
            watchlistIds={watchlistIds}
            historyMap={historyMap}
            shape={shapeCfg}
            homeLayout={homeCfg}
            user={profile}
            plans={plans}
            unlocksMap={adUnlocks}
            seriesSummariesMap={seriesSummariesMap}
            isMobile={isMobile}
            customAds={customAds}
            adSettings={adSettings}
            onSelectMovie={handleSelectMovie}
            onPlayMovie={handlePlayMovie}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {route.page === 'mylist' && (
          <BrowseView
            title={t('mylist', 'My List')}
            subtitle="Titles saved to watch later."
            movies={myListMovies}
            quickAddCatalog={movies}
            genres={genres}
            loading={catalogLoading}
            watchlistIds={watchlistIds}
            historyMap={historyMap}
            shape={shapeCfg}
            homeLayout={homeCfg}
            user={profile}
            plans={plans}
            unlocksMap={adUnlocks}
            seriesSummariesMap={seriesSummariesMap}
            isMobile={isMobile}
            customAds={customAds}
            adSettings={adSettings}
            onSelectMovie={handleSelectMovie}
            onPlayMovie={handlePlayMovie}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}

        {route.page === 'plans' && (
          <SubscriptionsView
            plans={plans}
            movies={movies}
            user={profile}
            orders={userOrders}
            highlightedPlanId={route.param}
            onRequestSubscription={handleRequestSubscription}
            onCancelSubscription={handleCancelSubscription}
            onOpenAuth={() => setAuthModalOpen(true)}
            onSelectMovie={handleSelectMovie}
          />
        )}

        {route.page === 'blog' && (
          <BlogView
            posts={publishedPosts}
            activeSlug={route.param}
            onSelectPost={(slug) => navigate(`/blog/${slug}`)}
            onBackToList={() => navigate('/blog')}
          />
        )}

        {route.page === 'page' && (
          <CustomPageView
            page={activeCustomPage}
            slug={route.param || ''}
            onBackHome={() => navigate('/home')}
            onNotify={notify}
          />
        )}

        {route.page === 'movie' && activeMovie && (
          <DetailsView
            movie={activeMovie}
            allMovies={movies}
            episodes={episodes}
            comments={comments}
            plans={plans}
            user={profile}
            inWatchlist={watchlistIds.has(activeMovie.id)}
            isLiked={likes.includes(activeMovie.id)}
            userRating={ratings[activeMovie.id] ?? 0}
            historyMap={historyMap}
            watchlistIds={watchlistIds}
            unlocksMap={adUnlocks}
            seriesSummariesMap={seriesSummariesMap}
            recentUnlockTimestamps={unlockTimestamps}
            isMobile={isMobile}
            featureFlags={featureFlags}
            shape={shapeCfg}
            homeLayout={homeCfg}
            sidebarAd={settings.ads?.sidebar}
            customAds={customAds}
            adSettings={adSettings}
            onPlay={handlePlayMovie}
            onSelectMovie={handleSelectMovie}
            onToggleWatchlist={handleToggleWatchlist}
            onToggleLike={handleToggleLike}
            onRate={handleRate}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
            onSubmitReport={handleSubmitReport}
            onShare={handleShare}
            onOpenAuth={() => setAuthModalOpen(true)}
            onSubscribePrompt={(planId) =>
              navigate(planId ? `/plans?plan=${encodeURIComponent(planId)}` : '/plans')
            }
          />
        )}

        {route.page === 'watch' && activeMovie && (
          <>
            <VideoPlayer
              movie={activeMovie}
              episode={activeEpisode}
              nextEpisode={nextEpisode}
              user={profile}
              plans={plans}
              unlocksMap={adUnlocks}
              recentUnlockTimestamps={unlockTimestamps}
              isOffline={!isOnline}
              initialProgress={historyMap[activeMovie.id]}
              playerConfig={settings.player}
              belowPlayerAd={settings.ads?.belowPlayer}
              customAds={customAds}
              vastAds={vastAds}
              adSettings={adSettings}
              onBack={() => navigate(`/movie/${activeMovie.slug}`)}
              onSaveProgress={handleSaveProgress}
              onSelectEpisode={(ep) => navigate(`/watch/${activeMovie.id}/${ep.seasonNumber}/${ep.id}`)}
              onOpenAuth={() => setAuthModalOpen(true)}
              onSubscribePrompt={(planId) =>
                navigate(planId ? `/plans?plan=${encodeURIComponent(planId)}` : '/plans')
              }
              onGrantAdUnlock={handleGrantAdUnlock}
            />
            <WatchRecommendations
              movie={activeMovie}
              allMovies={movies}
              episodes={episodes}
              activeEpisode={activeEpisode}
              inWatchlist={watchlistIds.has(activeMovie.id)}
              watchlistIds={watchlistIds}
              historyMap={historyMap}
              shape={shapeCfg}
              homeLayout={homeCfg}
              user={profile}
              plans={plans}
              unlocksMap={adUnlocks}
              adSettings={adSettings}
              seriesSummariesMap={seriesSummariesMap}
              isMobile={isMobile}
              onSelectEpisode={(ep) => navigate(`/watch/${activeMovie.id}/${ep.seasonNumber}/${ep.id}`)}
              onSelectMovie={handleSelectMovie}
              onPlayMovie={(m) => handlePlayMovie(m)}
              onToggleWatchlist={handleToggleWatchlist}
            />
          </>
        )}

        {route.page === 'profile' && (
          <ProfileView
            user={profile}
            history={history}
            historyEnabled={historyEnabled}
            moviesMap={moviesMap}
            onOpenAuth={() => setAuthModalOpen(true)}
            onUpdateProfile={async (name, photo) => {
              if (!profile) return;
              await updateOwnUserProfile(profile.uid, { displayName: name, photoURL: photo });
              setProfile({ ...profile, displayName: name, photoURL: photo });
              notify('Profile updated', 'success');
            }}
            onUploadAvatar={async (file, onProgress) => {
              if (!profile) throw new Error('Not signed in');
              return uploadFileWithProgress(
                `avatars/${profile.uid}/${Date.now()}-${file.name}`,
                file,
                onProgress
              );
            }}
            onChangePassword={async (pw) => {
              await updateCurrentUserPassword(pw);
              notify('Password updated', 'success');
            }}
            onToggleHistoryEnabled={handleToggleHistoryEnabled}
            onRemoveHistoryItem={async (movieId) => {
              setHistory((prev) => prev.filter((h) => h.movieId !== movieId));
              if (authUser) await removeUserHistoryItem(authUser.uid, movieId);
              notify('Removed from history', 'success');
            }}
            onClearHistory={async () => {
              const ids = history.map((h) => h.movieId);
              setHistory([]);
              try {
                localStorage.setItem('kv_guest_history', '[]');
              } catch {}
              if (authUser && ids.length > 0) await clearUserHistory(authUser.uid, ids);
              notify('Watch history cleared', 'success');
            }}
            onDeleteAccount={async () => {
              await deleteCurrentUserAccount();
              notify('Account deleted', 'info');
              navigate('/home');
            }}
            onPlayMovie={handlePlayMovie}
            onManagePlans={() => navigate('/plans')}
            librarySlot={
              profile ? (
                <LibraryDashboard
                  user={profile}
                  movies={movies}
                  moviesMap={moviesMap}
                  library={library}
                  watchlistIds={watchlistIds}
                  progressMap={progressMap}
                  activity={libraryActivity}
                  achievements={achievements}
                  ratings={ratings}
                  loading={libraryLoading}
                  onToggleWatchlist={handleToggleWatchlist}
                  onRateTitle={handleRate}
                  onPlayMovie={(m) => handlePlayMovie(m)}
                  onSelectMovie={handleSelectMovie}
                />
              ) : undefined
            }
          />
        )}

        {(route.page === 'notfound' ||
          ((route.page === 'movie' || route.page === 'watch') && !catalogLoading && !activeMovie)) && (
          <div className="mx-auto max-w-lg px-4 py-24 text-center">
            <h1 className="font-display text-3xl font-bold">Title Not Found</h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              The page or title you requested is unavailable.
            </p>
            <a
              href="#/home"
              className="kv-primary-btn mt-6 inline-block px-5 py-2.5 text-sm font-semibold"
            >
              Return Home
            </a>
          </div>
        )}
      </main>

      {/* Multi-Column Footer */}
      {(() => {
        const footerCfg = settings.footer;
        const columns = footerCfg?.columns ?? [];
        const enabledSocials = (footerCfg?.socialLinks ?? []).filter(
          (s) => s.enabled && s.url.trim()
        );
        const socialStyle = footerCfg?.socialIconStyle || 'outline';
        const footerLogo = brandingCfg?.footerLogoUrl || activeLogoUrl;
        const footerPages = publishedPages.filter((p) => p.showInFooter);

        return (
          <footer className="border-t border-zinc-200 bg-white py-12 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-[#08080c] dark:text-zinc-400">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-3">
                  {footerLogo ? (
                    <img
                      src={footerLogo}
                      alt={settings.siteName}
                      className="h-8 w-auto object-contain"
                    />
                  ) : (
                    <p className="font-display text-base font-bold text-zinc-900 dark:text-zinc-100">
                      {settings.siteName}
                    </p>
                  )}
                  <p className="leading-relaxed">
                    {brandingCfg?.tagline ||
                      'Streaming platform for licensed, original, and public-domain works.'}
                  </p>
                  {enabledSocials.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {enabledSocials.map((s) => (
                        <a
                          key={s.platform}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={s.platform}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold uppercase transition-colors ${
                            socialStyle === 'filled'
                              ? 'bg-[var(--kv-accent,#e50914)] text-white hover:opacity-90'
                              : socialStyle === 'minimal'
                              ? 'text-zinc-500 hover:text-[var(--kv-accent,#e50914)]'
                              : 'border border-zinc-300 text-zinc-600 hover:border-[var(--kv-accent,#e50914)] hover:text-[var(--kv-accent,#e50914)] dark:border-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          {renderSocialBadge(s.platform)}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {columns.map((col) => (
                  <div key={col.id}>
                    <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                      {col.title}
                    </h3>
                    <ul className="space-y-2">
                      {col.links.map((link) => (
                        <li key={`${col.id}-${link.label}`}>
                          <a
                            href={link.href}
                            className="transition-colors hover:text-zinc-900 dark:hover:text-white"
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {columns.length < 2 && footerPages.length > 0 && (
                  <div>
                    <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
                      Pages
                    </h3>
                    <ul className="space-y-2">
                      {footerPages.map((pg) => (
                        <li key={pg.id}>
                          <a
                            href={`#/page/${pg.slug}`}
                            className="transition-colors hover:text-zinc-900 dark:hover:text-white"
                          >
                            {pg.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-10 flex flex-col justify-between gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800/80 sm:flex-row sm:items-center">
                <div className="space-y-1">
                  <p className="font-medium text-zinc-700 dark:text-zinc-300">
                    {formatCopyrightText(
                      footerCfg?.copyrightText || `© {year} ${settings.siteName}. All rights reserved.`
                    )}
                  </p>
                  {footerCfg?.disclaimerText && (
                    <p className="max-w-2xl text-[11px] text-zinc-400">{footerCfg.disclaimerText}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <a
                    href="#/blog"
                    className="font-medium text-zinc-700 transition-colors hover:text-[var(--kv-accent,#e50914)] dark:text-zinc-200"
                  >
                    Blog
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowEntrance(true)}
                    className="transition-colors hover:text-zinc-900 dark:hover:text-white"
                  >
                    Replay Intro
                  </button>
                </div>
              </div>
            </div>
          </footer>
        );
      })()}

      {/* Mobile Bottom Tab Bar */}
      {(() => {
        const tabs = (navCfg?.mobileTabs ?? []).filter((tab) => {
          if (!tab.enabled) return false;
          if (featureFlags?.premiumSection === false && tab.href.includes('plans')) return false;
          if (featureFlags?.watchlist === false && tab.href.includes('mylist')) return false;
          return true;
        });
        if (tabs.length === 0) return null;
        return (
          <nav
            aria-label="Mobile navigation"
            className="fixed bottom-0 left-0 right-0 z-40 grid border-t border-zinc-200 bg-white/95 py-2 backdrop-blur-md dark:border-zinc-800 dark:bg-[#0b0b0f]/95 md:hidden"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {tabs.map((tab) => (
              <a
                key={tab.id}
                href={tab.href}
                className={`flex flex-col items-center gap-0.5 text-[11px] font-medium ${
                  tab.href.includes('plans')
                    ? 'text-amber-500'
                    : 'text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {renderNavIcon(tab.icon, 'h-4 w-4')}
                <span className="truncate max-w-full px-1">{tab.label}</span>
              </a>
            ))}
          </nav>
        );
      })()}

      {/* Global Overlays: Welcome/Promo/App-Install Popup + Cookie Consent */}
      <SitePopupOverlay popup={settings.popup} onNavigateHref={navigateHref} />
      <CookieConsentBar cookie={settings.cookieConsent} onNavigateHref={navigateHref} />

      {/* Auth Modal */}
      <AuthModal
        open={authModalOpen}
        allowRegistration={settings.allowRegistration}
        allowSocialLogin={featureFlags?.socialLogin !== false}
        onClose={() => {
          setAuthModalOpen(false);
          if (!auth.currentUser && window.location.pathname === '/auth') {
            window.history.replaceState(null, '', '/');
            setRoute({ page: 'home' });
          }
        }}
        onGoogleLogin={async () => {
          await signInWithGooglePopup();
          goToDashboard(false);
          notify('Signed in with Google', 'success');
        }}
        onEmailLogin={async (e, p) => {
          await signInWithEmail(e, p);
          goToDashboard(false);
          notify('Signed in', 'success');
        }}
        onEmailRegister={async (e, p, name) => {
          await registerWithEmail(e, p, name);
          goToDashboard(false);
          notify('Account created', 'success');
        }}
        onForgotPassword={async (e) => {
          await sendResetPassword(e);
          notify('Password reset email sent', 'info');
        }}
      />
    </div>
  );
}

export default function UserApp() {
  return (
    <ToastProvider>
      <UserPanelShell />
    </ToastProvider>
  );
}
