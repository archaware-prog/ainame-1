import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  CheckCircle2,
  Copy,
  Crown,
  Database,
  DollarSign,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Film,
  Flag,
  Image as ImageIcon,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Newspaper,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Tv,
  Users,
  X,
} from 'lucide-react';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  deleteBannerDoc,
  deleteCommentDoc,
  deleteContactMessageDoc,
  deleteCustomPageDoc,
  deleteGenreDoc,
  deleteMovieDoc,
  deletePlanDoc,
  fetchAllAdminData,
  isUserAdmin,
  saveBannerDoc,
  saveCustomPageDoc,
  saveGenreDoc,
  saveMovieDoc,
  savePlanDoc,
  saveSiteSettingsDoc,
  seedCatalogToFirestore,
  signInWithEmail,
  signInWithGooglePopup,
  signOutUser,
  syncUserProfileOnLogin,
  testFirestoreConnection,
  toggleCommentVisibility,
  updateContactMessageStatus,
  updateReportStatus,
  uploadFileWithProgress,
} from './lib/firebase';
import {
  deleteAdminUserBatch,
  exportUsersCsvAndLog,
  fetchAdminAggregateMetrics,
  fetchUsersPage,
  subscribeToPendingOrders,
  subscribeToRecentPaidSales,
  updateAdminUserBatch,
  updatePlanPricingBatch,
  updateTitleStatusBatch,
  type AdminAggregateSnapshot,
} from './lib/ordersFirebase';
import {
  DEFAULT_SITE_SETTINGS,
  SEED_BANNERS,
  SEED_GENRES,
  SEED_MOVIES,
  SEED_PAGES,
  SEED_PLANS,
} from './data/seedCatalog';
import { DEFAULT_AD_SETTINGS } from './data/seedAds';
import {
  deleteCustomAdDoc,
  deleteVastAdDoc,
  fetchAllAdsAdminData,
  saveAdSettings,
  saveCustomAdDoc,
  saveVastAdDoc,
  seedSampleAdsToFirestore,
} from './lib/adsFirebase';
import type {
  ActivityLogItem,
  AdEventItem,
  AdGlobalSettings,
  BannerItem,
  CommentItem,
  ContactMessage,
  CustomAdItem,
  CustomPage,
  GenreItem,
  MovieItem,
  OrderItem,
  ReportItem,
  SiteSettings,
  SubscriptionPlan,
  TitleStatus,
  UserProfile,
  VastAdItem,
} from './types/streaming';
import {
  calculateDashboardStats,
  formatCompactNumber,
  formatMonthlyPrice,
  formatRelativeTime,
  slugify,
  validateSubscriptionPlanDraft,
} from './utils/catalog';
import { formatCurrencyAmount, hasMaxTwoDecimals } from './utils/orders';
import { ConfirmDialog, Modal } from './components/ui/Modal';
import { ToastProvider, useToast } from './components/ui/Toast';
import { AdManagementHub, type AdsSubSection } from './components/admin/AdManagementHub';
import { AdUnlockAdminHub } from './components/admin/AdUnlockAdminHub';
import { AdminCharts } from './components/admin/AdminCharts';
import { BlogManager } from './components/admin/BlogManager';
import { CustomizationHub } from './components/admin/CustomizationHub';
import { EpisodesManager } from './components/admin/EpisodesManager';
import { MovieFormModal } from './components/admin/MovieFormModal';
import { OrdersManager } from './components/admin/OrdersManager';

type AdminTab =
  | 'dashboard'
  | 'movies'
  | 'subscriptions'
  | 'orders'
  | 'episodes'
  | 'genres'
  | 'banners'
  | 'ad_unlock'
  | 'ads_overview'
  | 'ads_custom'
  | 'ads_vast'
  | 'ads_settings'
  | 'ads_reports'
  | 'users'
  | 'blog'
  | 'comments'
  | 'reports'
  | 'settings'
  | 'logs';

function AdminShell() {
  const { notify } = useToast();
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [adminProfile, setAdminProfile] = useState<UserProfile | null>(null);
  const [accessDeniedMsg, setAccessDeniedMsg] = useState('');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  // Navigation
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Admin datasets
  const [movies, setMovies] = useState<MovieItem[]>([]);
  const [genres, setGenres] = useState<GenreItem[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [pages, setPages] = useState<CustomPage[]>(SEED_PAGES);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [customAds, setCustomAds] = useState<CustomAdItem[]>([]);
  const [vastAds, setVastAds] = useState<VastAdItem[]>([]);
  const [adEvents, setAdEvents] = useState<AdEventItem[]>([]);
  const [adSettings, setAdSettings] = useState<AdGlobalSettings>(DEFAULT_AD_SETTINGS);

  // Live aggregate metrics & recent sales
  const [liveMetrics, setLiveMetrics] = useState<AdminAggregateSnapshot | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [recentSales, setRecentSales] = useState<OrderItem[]>([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(false);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const metricsDebounceRef = useRef<number | null>(null);
  const initialSalesSnapSkipped = useRef(false);
  const initialPendingSnapSkipped = useRef(false);

  // Movies table state
  const [movieSearch, setMovieSearch] = useState('');
  const [movieTypeFilter, setMovieTypeFilter] = useState<'all' | 'movie' | 'series'>('all');
  const [movieStatusFilter, setMovieStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [selectedMovieIds, setSelectedMovieIds] = useState<Set<string>>(new Set());
  const [movieModalOpen, setMovieModalOpen] = useState(false);
  const [editingMovie, setEditingMovie] = useState<MovieItem | null>(null);
  const [deletingMovie, setDeletingMovie] = useState<MovieItem | null>(null);
  const [statusModalMovie, setStatusModalMovie] = useState<MovieItem | null>(null);
  const [statusModalValue, setStatusModalValue] = useState<TitleStatus>('published');
  const [savingTitleStatus, setSavingTitleStatus] = useState(false);

  // Subscriptions manager state
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [planPrice, setPlanPrice] = useState('9.99');
  const [planCurrency, setPlanCurrency] = useState('USD');
  const [planDescription, setPlanDescription] = useState('');
  const [planFeaturesInput, setPlanFeaturesInput] = useState('');
  const [planBadgeColor, setPlanBadgeColor] = useState('#e50914');
  const [planIsActive, setPlanIsActive] = useState(true);
  const [planErrors, setPlanErrors] = useState<Record<string, string>>({});
  const [savingPlan, setSavingPlan] = useState(false);
  const [pricingPlan, setPricingPlan] = useState<SubscriptionPlan | null>(null);
  const [pricingAmount, setPricingAmount] = useState('9.99');
  const [pricingCurrency, setPricingCurrency] = useState('USD');
  const [pricingActive, setPricingActive] = useState(true);
  const [savingPricing, setSavingPricing] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState<SubscriptionPlan | null>(null);

  // Genres form state
  const [newGenreName, setNewGenreName] = useState('');

  // Banners form state
  const [bannerMovieId, setBannerMovieId] = useState('');
  const [bannerImageUrl, setBannerImageUrl] = useState('');

  // Users cursor-paginated state
  const [userSearch, setUserSearch] = useState('');
  const [userPlanFilter, setUserPlanFilter] = useState<'all' | 'free' | 'premium'>('all');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'user' | 'admin'>('all');
  const [usersCursor, setUsersCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoadingMore, setUsersLoadingMore] = useState(false);
  const [exportingUsersCsv, setExportingUsersCsv] = useState(false);
  const [pendingUserAction, setPendingUserAction] = useState<{
    kind: 'plan' | 'role' | 'status' | 'delete';
    user: UserProfile;
  } | null>(null);
  const [userActionBusy, setUserActionBusy] = useState(false);

  // Reports filter
  const [reportFilter, setReportFilter] = useState<'all' | 'open' | 'resolved'>('all');

  // Logs filter
  const [logSearch, setLogSearch] = useState('');

  // Settings / Customization form state
  const [savingSettings, setSavingSettings] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('kv_theme', next);
    } catch {}
  };

  useEffect(() => {
    if (settings.primaryColor) {
      document.documentElement.style.setProperty('--kv-accent', settings.primaryColor);
    }
  }, [settings.primaryColor]);

  const refreshLiveMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      const snap = await fetchAdminAggregateMetrics();
      setLiveMetrics(snap);
      setPendingOrdersCount(snap.pendingOrdersCount);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to refresh dashboard metrics.', 'error');
    } finally {
      setMetricsLoading(false);
    }
  }, [notify]);

  const scheduleMetricsRefresh = useCallback(() => {
    if (metricsDebounceRef.current) {
      window.clearTimeout(metricsDebounceRef.current);
    }
    metricsDebounceRef.current = window.setTimeout(() => {
      void refreshLiveMetrics();
    }, 400);
  }, [refreshLiveMetrics]);

  const loadFirstUsersPage = useCallback(async () => {
    setUsersLoading(true);
    try {
      const page = await fetchUsersPage({
        roleFilter: userRoleFilter,
        planFilter: userPlanFilter,
        cursor: null,
        pageSize: 25,
      });
      setUsers(page.items);
      setUsersCursor(page.lastDoc);
      setUsersHasMore(page.hasMore);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load members.', 'error');
    } finally {
      setUsersLoading(false);
    }
  }, [userRoleFilter, userPlanFilter, notify]);

  const loadAllAdmin = async () => {
    setLoadingData(true);
    try {
      const [data, adsData] = await Promise.all([
        fetchAllAdminData(),
        fetchAllAdsAdminData(),
      ]);
      setMovies(data.movies.length > 0 ? data.movies : SEED_MOVIES);
      setGenres(data.genres.length > 0 ? data.genres : SEED_GENRES);
      setBanners(data.banners.length > 0 ? data.banners : SEED_BANNERS);
      setPlans(data.plans.length > 0 ? data.plans : SEED_PLANS);
      setComments(data.comments);
      setReports(data.reports);
      setPages(data.pages.length > 0 ? data.pages : SEED_PAGES);
      setMessages(data.messages);
      setLogs(data.logs);
      setSettings(data.settings);
      setCustomAds(adsData.customAds);
      setVastAds(adsData.vastAds);
      setAdEvents(adsData.adEvents);
      setAdSettings(adsData.adSettings);
      if (data.movies[0] && !bannerMovieId) {
        setBannerMovieId(data.movies[0].id);
        setBannerImageUrl(data.movies[0].bannerUrl || data.movies[0].posterUrl);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load admin data.', 'error');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    testFirestoreConnection();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthUser(u);
      if (!u) {
        setAdminProfile(null);
        setLiveMetrics(null);
        setRecentSales([]);
        setUsers([]);
        setAuthReady(true);
        return;
      }
      try {
        const prof = await syncUserProfileOnLogin(u);
        if (!isUserAdmin(prof, u)) {
          setAccessDeniedMsg(
            `Account "${u.email}" does not have admin privileges. Signed out automatically.`
          );
          await signOutUser();
          setAdminProfile(null);
          setAuthReady(true);
          return;
        }
        setAccessDeniedMsg('');
        setAdminProfile(prof);
        setAuthReady(true);
        await Promise.all([loadAllAdmin(), refreshLiveMetrics()]);
      } catch (err) {
        setAccessDeniedMsg(
          err instanceof Error ? err.message : 'Unable to verify administrator role.'
        );
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  // Load cursor-paginated users whenever admin is verified or filters change
  useEffect(() => {
    if (!authUser || !adminProfile) return;
    void loadFirstUsersPage();
  }, [authUser, adminProfile, loadFirstUsersPage]);

  // Real-time listeners (last 5 paid orders + pending orders count) & 60s visible polling
  useEffect(() => {
    if (!authUser || !adminProfile) return;
    initialSalesSnapSkipped.current = false;
    initialPendingSnapSkipped.current = false;
    setRecentSalesLoading(true);

    const unsubSales = subscribeToRecentPaidSales(
      (items) => {
        setRecentSales(items);
        setRecentSalesLoading(false);
        if (!initialSalesSnapSkipped.current) {
          initialSalesSnapSkipped.current = true;
          return;
        }
        scheduleMetricsRefresh();
      },
      (err) => {
        setRecentSalesLoading(false);
        notify(err.message, 'error');
      }
    );

    const unsubPending = subscribeToPendingOrders(
      (count) => {
        setPendingOrdersCount(count);
        if (!initialPendingSnapSkipped.current) {
          initialPendingSnapSkipped.current = true;
          return;
        }
        scheduleMetricsRefresh();
      },
      (err) => {
        notify(err.message, 'error');
      }
    );

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshLiveMetrics();
      }
    }, 60_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshLiveMetrics();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      unsubSales();
      unsubPending();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (metricsDebounceRef.current) {
        window.clearTimeout(metricsDebounceRef.current);
      }
    };
  }, [authUser, adminProfile, scheduleMetricsRefresh, refreshLiveMetrics, notify]);

  const stats = useMemo(
    () => calculateDashboardStats(movies, users, reports),
    [movies, users, reports]
  );

  const filteredMovies = useMemo(() => {
    const q = movieSearch.trim().toLowerCase();
    return movies.filter((m) => {
      if (movieTypeFilter !== 'all' && m.type !== movieTypeFilter) return false;
      if (movieStatusFilter !== 'all' && m.status !== movieStatusFilter) return false;
      if (q && !m.title.toLowerCase().includes(q) && !m.slug.includes(q)) return false;
      return true;
    });
  }, [movies, movieSearch, movieTypeFilter, movieStatusFilter]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (userPlanFilter !== 'all' && u.plan !== userPlanFilter) return false;
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
      if (
        q &&
        !u.displayName.toLowerCase().includes(q) &&
        !u.email.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [users, userSearch, userPlanFilter, userRoleFilter]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => reportFilter === 'all' || r.status === reportFilter);
  }, [reports, reportFilter]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter(
      (l) => !q || l.action.toLowerCase().includes(q) || l.targetId.toLowerCase().includes(q)
    );
  }, [logs, logSearch]);

  const moviesMap = useMemo(() => {
    const map: Record<string, MovieItem> = {};
    movies.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [movies]);

  // Auth Login Gate
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f] text-zinc-400">
        Verifying administrator session...
      </div>
    );
  }

  if (!authUser || !adminProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-[#0b0b0f]">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-[#13131c]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-[var(--kv-accent,#e50914)]" />
              <span className="font-display text-lg font-bold">AIname Admin</span>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <h1 className="mt-5 font-display text-2xl font-bold tracking-tight">
            Administrator Sign In
          </h1>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Access is restricted to accounts with <code className="font-mono">role = "admin"</code>{' '}
            or the workspace owner ({BOOTSTRAPPED_ADMIN_EMAIL}).
          </p>

          {accessDeniedMsg && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-500">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{accessDeniedMsg}</span>
            </div>
          )}

          <div className="mt-6 space-y-4">
            <button
              type="button"
              disabled={loginBusy}
              onClick={async () => {
                setLoginBusy(true);
                setAccessDeniedMsg('');
                try {
                  await signInWithGooglePopup();
                } catch (err) {
                  setAccessDeniedMsg(
                    err instanceof Error ? err.message : 'Something went wrong. Please try again.'
                  );
                } finally {
                  setLoginBusy(false);
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              Continue with Google
            </button>

            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              <span>or credentials</span>
              <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoginBusy(true);
                setAccessDeniedMsg('');
                try {
                  await signInWithEmail(loginEmail.trim(), loginPassword);
                } catch (err) {
                  setAccessDeniedMsg(
                    err instanceof Error ? err.message : 'Something went wrong. Please try again.'
                  );
                } finally {
                  setLoginBusy(false);
                }
              }}
              className="space-y-3"
            >
              <div>
                <label htmlFor="adm-email" className="mb-1 block text-xs text-zinc-500">
                  Admin Email
                </label>
                <input
                  id="adm-email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
              <div>
                <label htmlFor="adm-pw" className="mb-1 block text-xs text-zinc-500">
                  Password
                </label>
                <input
                  id="adm-pw"
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
              </div>
              <button
                type="submit"
                disabled={loginBusy}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {loginBusy ? 'Signing In...' : 'Sign In'}
              </button>
            </form>

            <div className="border-t border-zinc-200 pt-4 text-center dark:border-zinc-800">
              <a
                href="/index.html"
                className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              >
                Return to User Streaming Panel
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const navItems: {
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    group?: 'Advertising';
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'movies', label: 'Movies & Series', icon: <Film className="h-4 w-4" /> },
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      icon: <Crown className="h-4 w-4" />,
      badge: plans.filter((p) => p.isActive).length || undefined,
    },
    {
      id: 'orders',
      label: 'Orders',
      icon: <Receipt className="h-4 w-4" />,
      badge: pendingOrdersCount || liveMetrics?.pendingOrdersCount || undefined,
    },
    { id: 'episodes', label: 'Episodes', icon: <Layers className="h-4 w-4" /> },
    { id: 'genres', label: 'Genres', icon: <Tag className="h-4 w-4" /> },
    { id: 'banners', label: 'Banners', icon: <ImageIcon className="h-4 w-4" /> },
    {
      id: 'ad_unlock',
      label: 'Ad Unlock & Badges',
      icon: <Sparkles className="h-4 w-4" />,
      group: 'Advertising',
    },
    { id: 'ads_overview', label: 'Ads Overview', icon: <BarChart3 className="h-4 w-4" />, group: 'Advertising' },
    {
      id: 'ads_custom',
      label: 'Custom Ads',
      icon: <ImageIcon className="h-4 w-4" />,
      badge: customAds.length || undefined,
      group: 'Advertising',
    },
    {
      id: 'ads_vast',
      label: 'VAST Ads',
      icon: <Tv className="h-4 w-4" />,
      badge: vastAds.length || undefined,
      group: 'Advertising',
    },
    { id: 'ads_settings', label: 'Ad Settings', icon: <SettingsIcon className="h-4 w-4" />, group: 'Advertising' },
    { id: 'ads_reports', label: 'Ad Reports', icon: <Download className="h-4 w-4" />, group: 'Advertising' },
    { id: 'users', label: 'Users', icon: <Users className="h-4 w-4" /> },
    { id: 'blog', label: 'Blog', icon: <Newspaper className="h-4 w-4" /> },
    { id: 'comments', label: 'Comments', icon: <MessageSquare className="h-4 w-4" /> },
    {
      id: 'reports',
      label: 'Reports',
      icon: <Flag className="h-4 w-4" />,
      badge: stats.openReports || undefined,
    },
    {
      id: 'settings',
      label: 'Customize & Settings',
      icon: <SettingsIcon className="h-4 w-4" />,
      badge: messages.filter((m) => m.status === 'unread').length || undefined,
    },
    { id: 'logs', label: 'Activity Log', icon: <Activity className="h-4 w-4" /> },
  ];

  const handleBulkAction = async (action: 'publish' | 'draft' | 'feature' | 'delete') => {
    if (selectedMovieIds.size === 0) return;
    const targets = movies.filter((m) => selectedMovieIds.has(m.id));
    for (const m of targets) {
      if (action === 'delete') {
        await deleteMovieDoc(m.id, adminProfile.uid);
      } else {
        const updated: MovieItem = {
          ...m,
          status: action === 'publish' ? 'published' : action === 'draft' ? 'draft' : m.status,
          isFeatured: action === 'feature' ? true : m.isFeatured,
          updatedAt: new Date().toISOString(),
        };
        await saveMovieDoc(updated, adminProfile.uid, false);
      }
    }
    setSelectedMovieIds(new Set());
    await Promise.all([loadAllAdmin(), refreshLiveMetrics()]);
    notify(`Bulk action "${action}" completed for ${targets.length} titles`, 'success');
  };

  const handleToggleMovieFlag = async (
    movie: MovieItem,
    field: 'isFeatured' | 'isTrending' | 'isPremium'
  ) => {
    const updated: MovieItem = {
      ...movie,
      [field]: !movie[field],
      updatedAt: new Date().toISOString(),
    };
    setMovies((prev) => prev.map((m) => (m.id === movie.id ? updated : m)));
    await saveMovieDoc(updated, adminProfile.uid, false);
    notify(`Updated ${movie.title}`, 'success');
  };

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-[#0b0b0f] dark:text-zinc-100">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 dark:border-zinc-800 dark:bg-[#111118] lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
          <div className="flex items-center gap-2 font-display text-lg font-bold">
            <span className="h-2.5 w-2.5 rounded-sm bg-[var(--kv-accent,#e50914)]" />
            <span>{settings.siteName} Admin</span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="rounded p-1 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Admin sections">
          {navItems.map((item, idx) => {
            const showGroupHeader =
              item.group && (idx === 0 || navItems[idx - 1].group !== item.group);
            return (
              <React.Fragment key={item.id}>
                {showGroupHeader && (
                  <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    {item.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setSidebarOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === item.id
                      ? 'bg-[var(--kv-accent,#e50914)] text-white'
                      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/70'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {item.icon}
                    {item.label}
                  </span>
                  {item.badge !== undefined && (
                    <span className="font-mono-tabular rounded bg-black/20 px-1.5 py-0.5 text-[11px]">
                      {item.badge}
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <a
            href="/index.html"
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Tv className="h-3.5 w-3.5" />
            View User Panel
          </a>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-[#0b0b0f]/90 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="font-display text-lg font-semibold capitalize">
              {navItems.find((n) => n.id === activeTab)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {adminProfile.displayName}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => signOutUser()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-6">
          {/* 1. DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold">Platform Overview</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Real-time metrics across catalog, members, revenue, and orders
                    {liveMetrics?.lastUpdatedAt && (
                      <span className="ml-2 text-zinc-400">
                        · Updated {formatRelativeTime(liveMetrics.lastUpdatedAt)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={metricsLoading}
                    onClick={() => void refreshLiveMetrics()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${metricsLoading ? 'animate-spin' : ''}`} />
                    Refresh Metrics
                  </button>
                  <button
                    type="button"
                    disabled={seeding}
                    onClick={async () => {
                      setSeeding(true);
                      try {
                        await seedCatalogToFirestore(adminProfile.uid);
                        await Promise.all([loadAllAdmin(), refreshLiveMetrics()]);
                        notify('Sample catalog seeded to Firestore', 'success');
                      } finally {
                        setSeeding(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Database className="h-3.5 w-3.5" />
                    {seeding ? 'Seeding...' : 'Seed Sample Catalog'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMovie(null);
                      setMovieModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Quick Add Title
                  </button>
                </div>
              </div>

              {/* Live KPI Grid */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {metricsLoading && !liveMetrics ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c]"
                    >
                      <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                      <div className="mt-3 h-7 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                      <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                    </div>
                  ))
                ) : (
                  [
                    {
                      label: 'Published Titles',
                      val: liveMetrics
                        ? liveMetrics.publishedTitles
                        : movies.filter((m) => m.status === 'published').length,
                      sub: `${movies.length} total in catalog`,
                      targetTab: 'movies' as AdminTab,
                    },
                    {
                      label: 'Total Students',
                      val: liveMetrics ? liveMetrics.totalStudents : stats.totalUsers,
                      sub: `+${liveMetrics ? liveMetrics.newStudents7d : stats.newUsersLast7Days} new (7d)`,
                      targetTab: 'users' as AdminTab,
                    },
                    {
                      label: 'Total Revenue',
                      val: formatCurrencyAmount(
                        liveMetrics?.totalRevenue ?? 0,
                        liveMetrics?.primaryCurrency ?? 'USD'
                      ),
                      sub: `Refunded: ${formatCurrencyAmount(
                        liveMetrics?.refundedTotal ?? 0,
                        liveMetrics?.primaryCurrency ?? 'USD'
                      )}`,
                      targetTab: 'orders' as AdminTab,
                    },
                    {
                      label: 'New Orders Today',
                      val: liveMetrics?.newOrdersToday ?? 0,
                      sub: `${pendingOrdersCount} awaiting review`,
                      targetTab: 'orders' as AdminTab,
                    },
                    {
                      label: 'Total Views',
                      val: formatCompactNumber(stats.totalViews),
                      sub: `${liveMetrics?.premiumUsersCount ?? stats.premiumUsers} Plus members`,
                      targetTab: 'movies' as AdminTab,
                    },
                    {
                      label: 'Open Reports',
                      val: stats.openReports,
                      sub: 'Playback & content queue',
                      targetTab: 'reports' as AdminTab,
                    },
                  ].map((kpi) => (
                    <button
                      key={kpi.label}
                      type="button"
                      onClick={() => setActiveTab(kpi.targetTab)}
                      className="rounded-xl border border-zinc-200 bg-white p-4 text-left transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-[#13131c] dark:hover:border-zinc-600"
                    >
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{kpi.label}</p>
                      <p className="font-mono-tabular mt-1.5 text-2xl font-bold">{kpi.val}</p>
                      <p className="mt-1 truncate text-[11px] text-zinc-400">{kpi.sub}</p>
                    </button>
                  ))
                )}
              </div>

              <AdminCharts
                movies={movies}
                users={users}
                memberCounts={
                  liveMetrics
                    ? {
                        free: liveMetrics.freeUsersCount,
                        premium: liveMetrics.premiumUsersCount,
                      }
                    : undefined
                }
              />

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Recent Sales (Last 5 Paid Orders) */}
                <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-sm font-semibold">Recent Sales</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('orders')}
                      className="text-xs font-semibold text-[var(--kv-accent,#e50914)] hover:underline"
                    >
                      View All Orders
                    </button>
                  </div>
                  {recentSalesLoading ? (
                    <div className="space-y-2.5">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-10 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900"
                        />
                      ))}
                    </div>
                  ) : recentSales.length === 0 ? (
                    <p className="py-4 text-xs text-zinc-500">
                      No paid orders recorded yet. Confirm a pending request or create a manual order in Orders.
                    </p>
                  ) : (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {recentSales.map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between gap-3 py-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              {order.userName || order.userEmail}
                            </p>
                            <p className="truncate text-[11px] text-zinc-500">
                              {order.planName} · <span className="uppercase">{order.paymentMethod}</span>
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono-tabular font-bold text-emerald-500">
                              {formatCurrencyAmount(order.amount, order.currency)}
                            </p>
                            <p className="font-mono-tabular text-[11px] text-zinc-500">
                              {formatRelativeTime(order.paidAt || order.createdAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Activity */}
                <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-sm font-semibold">Recent Admin Activity</h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('logs')}
                      className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                    >
                      Audit Log
                    </button>
                  </div>
                  {logs.length === 0 ? (
                    <p className="py-4 text-xs text-zinc-500">
                      No activity logged yet. Seed the catalog or edit a title to record audit events.
                    </p>
                  ) : (
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                      {logs.slice(0, 5).map((log) => (
                        <div key={log.id} className="flex items-center justify-between py-2.5 text-xs">
                          <span className="truncate pr-3">{log.action}</span>
                          <span className="font-mono-tabular shrink-0 text-zinc-500">
                            {formatRelativeTime(log.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. MOVIES & SERIES CRUD */}
          {activeTab === 'movies' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="search"
                      value={movieSearch}
                      onChange={(e) => setMovieSearch(e.target.value)}
                      placeholder="Filter titles..."
                      className="rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-3 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
                    />
                  </div>
                  <select
                    value={movieTypeFilter}
                    onChange={(e) =>
                      setMovieTypeFilter(e.target.value as 'all' | 'movie' | 'series')
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
                  >
                    <option value="all">All Types</option>
                    <option value="movie">Movies</option>
                    <option value="series">Series</option>
                  </select>
                  <select
                    value={movieStatusFilter}
                    onChange={(e) =>
                      setMovieStatusFilter(e.target.value as 'all' | 'published' | 'draft')
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
                  >
                    <option value="all">All Status</option>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedMovieIds.size > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleBulkAction('publish')}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
                      >
                        Publish ({selectedMovieIds.size})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkAction('draft')}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
                      >
                        Draft
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkAction('feature')}
                        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
                      >
                        Feature
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBulkAction('delete')}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Delete
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMovie(null);
                      setMovieModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Title
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#13131c]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                    <tr>
                      <th className="p-3">
                        <input
                          type="checkbox"
                          aria-label="Select all titles"
                          checked={
                            filteredMovies.length > 0 &&
                            selectedMovieIds.size === filteredMovies.length
                          }
                          onChange={(e) =>
                            setSelectedMovieIds(
                              e.target.checked
                                ? new Set(filteredMovies.map((m) => m.id))
                                : new Set()
                            )
                          }
                        />
                      </th>
                      <th className="p-3">Title</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Year</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Views</th>
                      <th className="p-3 text-center">Featured</th>
                      <th className="p-3 text-center">Trending</th>
                      <th className="p-3">Sign-In Gate</th>
                      <th className="p-3">Subscription Plan</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {filteredMovies.map((m) => (
                      <tr key={m.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${m.title}`}
                            checked={selectedMovieIds.has(m.id)}
                            onChange={(e) => {
                              const next = new Set(selectedMovieIds);
                              if (e.target.checked) next.add(m.id);
                              else next.delete(m.id);
                              setSelectedMovieIds(next);
                            }}
                          />
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-3">
                            <img
                              src={m.posterUrl}
                              alt={m.title}
                              className="h-10 w-7 rounded object-cover"
                            />
                            <div>
                              <p className="font-semibold">{m.title}</p>
                              <p className="font-mono text-[11px] text-zinc-500">{m.slug}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 capitalize">{m.type}</td>
                        <td className="font-mono-tabular p-3">{m.releaseYear}</td>
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => {
                              setStatusModalMovie(m);
                              setStatusModalValue(m.status);
                            }}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold capitalize ${
                              m.status === 'published'
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            }`}
                            title="Change title status"
                          >
                            {m.status}
                          </button>
                        </td>
                        <td className="font-mono-tabular p-3 text-right">
                          {formatCompactNumber(m.views)}
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={m.isFeatured}
                            aria-label={`Toggle featured for ${m.title}`}
                            onChange={() => handleToggleMovieFlag(m, 'isFeatured')}
                            className="accent-[var(--kv-accent,#e50914)]"
                          />
                        </td>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={m.isTrending}
                            aria-label={`Toggle trending for ${m.title}`}
                            onChange={() => handleToggleMovieFlag(m, 'isTrending')}
                            className="accent-[var(--kv-accent,#e50914)]"
                          />
                        </td>
                        <td className="p-3">
                          {m.requiredPlanId || m.isPremium ? (
                            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">
                              Required (Plan)
                            </span>
                          ) : (
                            <select
                              aria-label={`Sign-in requirement for ${m.title}`}
                              value={m.requiresSignIn ? 'signin' : 'free'}
                              onChange={async (e) => {
                                const nextRequiresSignIn = e.target.value === 'signin';
                                const updated: MovieItem = {
                                  ...m,
                                  requiresSignIn: nextRequiresSignIn,
                                  updatedAt: new Date().toISOString(),
                                };
                                setMovies((prev) =>
                                  prev.map((x) => (x.id === m.id ? updated : x))
                                );
                                await saveMovieDoc(updated, adminProfile.uid, false);
                                notify(
                                  nextRequiresSignIn
                                    ? `"${m.title}" now requires sign-in to watch`
                                    : `"${m.title}" is now public (no sign-in required)`,
                                  'success'
                                );
                              }}
                              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                            >
                              <option value="free">No Sign-In (Free)</option>
                              <option value="signin">Sign-In Required</option>
                            </select>
                          )}
                        </td>
                        <td className="p-3">
                          <select
                            aria-label={`Assign subscription plan for ${m.title}`}
                            value={m.requiredPlanId ?? ''}
                            onChange={async (e) => {
                              const planId = e.target.value || null;
                              const chosen = planId ? plans.find((p) => p.id === planId) : null;
                              const updated: MovieItem = {
                                ...m,
                                requiredPlanId: planId,
                                requiredPlanName: chosen ? chosen.name : null,
                                isPremium: Boolean(planId),
                                updatedAt: new Date().toISOString(),
                              };
                              setMovies((prev) =>
                                prev.map((x) => (x.id === m.id ? updated : x))
                              );
                              await saveMovieDoc(updated, adminProfile.uid, false);
                              notify(
                                chosen
                                  ? `"${m.title}" now requires ${chosen.name}`
                                  : `"${m.title}" is now free to watch`,
                                'success'
                              );
                            }}
                            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                          >
                            <option value="">Free (All Users)</option>
                            {plans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({formatMonthlyPrice(p.pricePerMonth, p.currency)})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMovie(m);
                                setMovieModalOpen(true);
                              }}
                              aria-label={`Edit ${m.title}`}
                              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const now = new Date().toISOString();
                                const copy: MovieItem = {
                                  ...m,
                                  id: `${m.id}-copy-${Date.now().toString(36)}`,
                                  title: `${m.title} (Copy)`,
                                  slug: `${m.slug}-copy-${Date.now().toString(36)}`,
                                  status: 'draft',
                                  views: 0,
                                  createdAt: now,
                                  updatedAt: now,
                                };
                                await saveMovieDoc(copy, adminProfile.uid, true);
                                setMovies((prev) => [copy, ...prev]);
                                notify(`Duplicated "${m.title}"`, 'success');
                              }}
                              aria-label={`Duplicate ${m.title}`}
                              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingMovie(m)}
                              aria-label={`Delete ${m.title}`}
                              className="rounded p-1.5 text-zinc-500 hover:text-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {loadingData && (
                  <p className="p-4 text-center text-xs text-zinc-500">Refreshing catalog...</p>
                )}
              </div>
            </div>
          )}

          {/* 2B. SUBSCRIPTIONS & MONTHLY PLANS */}
          {activeTab === 'subscriptions' && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold">
                      Monthly Subscription Plans ({plans.length})
                    </h2>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Create monthly plans here, then assign any plan to a movie or series in Movies &amp; Series so only subscribers to that plan can watch it.
                    </p>
                  </div>
                </div>

                {plans.length === 0 ? (
                  <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-[#13131c]">
                    No monthly plans created yet. Use the form on the right to create your first plan.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {plans.map((p) => {
                      const assignedCount = movies.filter((m) => m.requiredPlanId === p.id).length;
                      const subscriberCount = users.filter((u) => u.subscriptionPlanId === p.id).length;
                      return (
                        <div
                          key={p.id}
                          className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c] sm:flex-row sm:items-start"
                        >
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                                style={{ backgroundColor: p.badgeColor || '#e50914' }}
                              >
                                <Crown className="h-3.5 w-3.5" />
                              </span>
                              <h3 className="font-display text-base font-bold">{p.name}</h3>
                              <span className="font-mono-tabular text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {formatMonthlyPrice(p.pricePerMonth, p.currency)}
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  p.isActive ? 'text-emerald-500' : 'text-zinc-400'
                                }`}
                              >
                                · {p.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </div>

                            {p.description && (
                              <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                                {p.description}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 tabular-nums">
                              <span>{assignedCount} assigned videos</span>
                              <span aria-hidden="true">·</span>
                              <span>{subscriberCount} loaded subscribers</span>
                              {p.features.length > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="truncate">{p.features.join(' / ')}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPricingPlan(p);
                                setPricingAmount(String(p.pricePerMonth));
                                setPricingCurrency(p.currency);
                                setPricingActive(p.isActive);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                              <DollarSign className="h-3.5 w-3.5" />
                              Edit Pricing
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlanId(p.id);
                                setPlanName(p.name);
                                setPlanPrice(String(p.pricePerMonth));
                                setPlanCurrency(p.currency);
                                setPlanDescription(p.description);
                                setPlanFeaturesInput(p.features.join('\n'));
                                setPlanBadgeColor(p.badgeColor || '#e50914');
                                setPlanIsActive(p.isActive);
                                setPlanErrors({});
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const updated: SubscriptionPlan = {
                                  ...p,
                                  isActive: !p.isActive,
                                  updatedAt: new Date().toISOString(),
                                };
                                await savePlanDoc(updated, adminProfile.uid, false);
                                setPlans((prev) =>
                                  prev.map((x) => (x.id === p.id ? updated : x))
                                );
                                notify(
                                  `${p.name} marked ${updated.isActive ? 'active' : 'inactive'}`,
                                  'success'
                                );
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                              {p.isActive ? 'Disable' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingPlan(p)}
                              aria-label={`Delete plan ${p.name}`}
                              className="rounded p-1.5 text-zinc-400 hover:text-rose-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const now = new Date().toISOString();
                  const existing = editingPlanId
                    ? plans.find((x) => x.id === editingPlanId)
                    : undefined;
                  const cleanName = planName.trim();
                  const planSlug = slugify(cleanName);
                  const parsedPrice = Number(planPrice);
                  const features = planFeaturesInput
                    .split(/\n|,/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 12);

                  const candidate: SubscriptionPlan = {
                    id: existing?.id ?? `plan-${planSlug}-${Date.now().toString(36)}`,
                    name: cleanName,
                    slug: planSlug,
                    pricePerMonth: parsedPrice,
                    currency: planCurrency.trim().toUpperCase() || 'USD',
                    billingInterval: 'monthly',
                    description: planDescription.trim().slice(0, 500),
                    features,
                    badgeColor: planBadgeColor || '#e50914',
                    isActive: planIsActive,
                    order: existing?.order ?? plans.length + 1,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                  };

                  const validation = validateSubscriptionPlanDraft(candidate);
                  if (Object.keys(validation).length > 0) {
                    setPlanErrors(validation);
                    return;
                  }

                  setSavingPlan(true);
                  setPlanErrors({});
                  try {
                    await savePlanDoc(candidate, adminProfile.uid, !existing);
                    setPlans((prev) =>
                      existing
                        ? prev.map((x) => (x.id === candidate.id ? candidate : x))
                        : [...prev, candidate]
                    );
                    notify(
                      existing
                        ? `Updated monthly plan "${candidate.name}"`
                        : `Created monthly plan "${candidate.name}"`,
                      'success'
                    );
                    setEditingPlanId(null);
                    setPlanName('');
                    setPlanPrice('9.99');
                    setPlanCurrency('USD');
                    setPlanDescription('');
                    setPlanFeaturesInput('');
                    setPlanBadgeColor('#e50914');
                    setPlanIsActive(true);
                  } finally {
                    setSavingPlan(false);
                  }
                }}
                className="h-fit space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold">
                    {editingPlanId ? 'Edit Monthly Plan' : 'Create Monthly Plan'}
                  </h3>
                  {editingPlanId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPlanId(null);
                        setPlanName('');
                        setPlanPrice('9.99');
                        setPlanCurrency('USD');
                        setPlanDescription('');
                        setPlanFeaturesInput('');
                        setPlanBadgeColor('#e50914');
                        setPlanIsActive(true);
                        setPlanErrors({});
                      }}
                      className="text-xs text-zinc-500 hover:underline"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <div>
                  <label htmlFor="plan-name" className="mb-1 block text-xs text-zinc-500">
                    Plan Name *
                  </label>
                  <input
                    id="plan-name"
                    type="text"
                    required
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    placeholder="e.g. Cinema Plus"
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                  />
                  {planErrors.name && <p className="mt-1 text-xs text-rose-500">{planErrors.name}</p>}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label htmlFor="plan-price" className="mb-1 block text-xs text-zinc-500">
                      Price / Month *
                    </label>
                    <input
                      id="plan-price"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={planPrice}
                      onChange={(e) => setPlanPrice(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm tabular-nums dark:border-zinc-700"
                    />
                    {planErrors.pricePerMonth && (
                      <p className="mt-1 text-xs text-rose-500">{planErrors.pricePerMonth}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="plan-currency" className="mb-1 block text-xs text-zinc-500">
                      Currency
                    </label>
                    <select
                      id="plan-currency"
                      value={planCurrency}
                      onChange={(e) => setPlanCurrency(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                      <option value="INR">INR (₹)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="plan-desc" className="mb-1 block text-xs text-zinc-500">
                    Description
                  </label>
                  <textarea
                    id="plan-desc"
                    rows={2}
                    value={planDescription}
                    onChange={(e) => setPlanDescription(e.target.value)}
                    placeholder="What videos and perks this monthly subscription unlocks..."
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                  />
                </div>

                <div>
                  <label htmlFor="plan-features" className="mb-1 block text-xs text-zinc-500">
                    Benefits (one per line)
                  </label>
                  <textarea
                    id="plan-features"
                    rows={3}
                    value={planFeaturesInput}
                    onChange={(e) => setPlanFeaturesInput(e.target.value)}
                    placeholder={'4K HDR Playback\nAd-free series access\nOffline watchlist sync'}
                    className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <label htmlFor="plan-color" className="text-xs text-zinc-500">
                      Badge Color
                    </label>
                    <input
                      id="plan-color"
                      type="color"
                      value={planBadgeColor}
                      onChange={(e) => setPlanBadgeColor(e.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-zinc-700"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={planIsActive}
                      onChange={(e) => setPlanIsActive(e.target.checked)}
                      className="accent-[var(--kv-accent,#e50914)]"
                    />
                    <span>Active</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingPlan}
                  className="w-full rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingPlan
                    ? 'Saving Plan...'
                    : editingPlanId
                    ? 'Save Plan Changes'
                    : 'Create Monthly Plan'}
                </button>
              </form>
            </div>
          )}

          {/* 2C. ORDERS & SALES HISTORY */}
          {activeTab === 'orders' && (
            <OrdersManager
              adminUid={adminProfile.uid}
              plans={plans}
              onMutateSuccess={() => void refreshLiveMetrics()}
              onNotify={notify}
            />
          )}

          {/* 3. EPISODES MANAGER */}
          {activeTab === 'episodes' && (
            <EpisodesManager movies={movies} adminUid={adminProfile.uid} adSettings={adSettings} />
          )}

          {/* 4. GENRES */}
          {activeTab === 'genres' && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c] lg:col-span-2">
                <h2 className="mb-4 font-display text-base font-semibold">Genres ({genres.length})</h2>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {genres.map((g, idx) => (
                    <div key={g.id} className="flex items-center justify-between py-2.5 text-sm">
                      <div>
                        <span className="font-semibold">{g.name}</span>
                        <span className="ml-2 font-mono text-xs text-zinc-500">{g.slug}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={async () => {
                            const next = [...genres];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            const reordered = next.map((item, i) => ({ ...item, order: i + 1 }));
                            setGenres(reordered);
                            for (const item of reordered) await saveGenreDoc(item, adminProfile.uid);
                            notify('Genre order updated', 'success');
                          }}
                          className="rounded p-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-white"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === genres.length - 1}
                          onClick={async () => {
                            const next = [...genres];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            const reordered = next.map((item, i) => ({ ...item, order: i + 1 }));
                            setGenres(reordered);
                            for (const item of reordered) await saveGenreDoc(item, adminProfile.uid);
                            notify('Genre order updated', 'success');
                          }}
                          className="rounded p-1 text-zinc-400 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-white"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteGenreDoc(g.id, adminProfile.uid);
                            setGenres((prev) => prev.filter((x) => x.id !== g.id));
                            notify(`Deleted genre "${g.name}"`, 'success');
                          }}
                          className="rounded p-1 text-zinc-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const name = newGenreName.trim();
                  if (!name) return;
                  const g: GenreItem = {
                    id: `genre-${slugify(name)}`,
                    name,
                    slug: slugify(name),
                    order: genres.length + 1,
                  };
                  await saveGenreDoc(g, adminProfile.uid);
                  setGenres((prev) => [...prev, g]);
                  setNewGenreName('');
                  notify(`Added genre "${name}"`, 'success');
                }}
                className="h-fit space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]"
              >
                <h3 className="font-display text-sm font-semibold">Add Genre</h3>
                <input
                  type="text"
                  required
                  placeholder="e.g. Animation"
                  value={newGenreName}
                  onChange={(e) => setNewGenreName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white"
                >
                  Create Genre
                </button>
              </form>
            </div>
          )}

          {/* 5. BANNERS */}
          {activeTab === 'banners' && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-3 lg:col-span-2">
                {banners.map((b) => {
                  const target = moviesMap[b.movieId];
                  return (
                    <div
                      key={b.id}
                      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#13131c] sm:flex-row sm:items-center"
                    >
                      <img
                        src={b.imageUrl}
                        alt={target?.title ?? b.movieId}
                        className="h-20 w-36 rounded-lg object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-display font-semibold">
                          {target?.title ?? b.movieId}
                        </p>
                        <p className="font-mono-tabular text-xs text-zinc-500">
                          Order #{b.order} · {b.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const updated = { ...b, isActive: !b.isActive };
                            await saveBannerDoc(updated, adminProfile.uid);
                            setBanners((prev) =>
                              prev.map((x) => (x.id === b.id ? updated : x))
                            );
                          }}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
                        >
                          {b.isActive ? 'Disable' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteBannerDoc(b.id, adminProfile.uid);
                            setBanners((prev) => prev.filter((x) => x.id !== b.id));
                            notify('Banner deleted', 'success');
                          }}
                          className="rounded p-1.5 text-zinc-400 hover:text-rose-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!bannerMovieId || !bannerImageUrl.trim()) return;
                  const b: BannerItem = {
                    id: `banner-${Date.now()}`,
                    movieId: bannerMovieId,
                    imageUrl: bannerImageUrl.trim(),
                    order: banners.length + 1,
                    isActive: true,
                  };
                  await saveBannerDoc(b, adminProfile.uid);
                  setBanners((prev) => [...prev, b]);
                  notify('Banner added', 'success');
                }}
                className="h-fit space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]"
              >
                <h3 className="font-display text-sm font-semibold">Add Hero Banner</h3>
                <select
                  value={bannerMovieId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setBannerMovieId(id);
                    const m = moviesMap[id];
                    if (m) setBannerImageUrl(m.bannerUrl || m.posterUrl);
                  }}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {movies.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={bannerImageUrl}
                  onChange={(e) => setBannerImageUrl(e.target.value)}
                  placeholder="Banner image URL"
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
                />
                <label className="block cursor-pointer rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-center text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
                  Upload Banner File
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = await uploadFileWithProgress(`banners/${Date.now()}-${f.name}`, f);
                      setBannerImageUrl(url);
                    }}
                  />
                </label>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white"
                >
                  Save Banner
                </button>
              </form>
            </div>
          )}

          {/* 6. USERS MANAGEMENT (CURSOR-PAGINATED 25/PAGE) */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Filter loaded members..."
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
                  />
                  <select
                    value={userRoleFilter}
                    onChange={(e) =>
                      setUserRoleFilter(e.target.value as 'all' | 'user' | 'admin')
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
                  >
                    <option value="all">All Roles</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <select
                    value={userPlanFilter}
                    onChange={(e) =>
                      setUserPlanFilter(e.target.value as 'all' | 'free' | 'premium')
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
                  >
                    <option value="all">All Plans</option>
                    <option value="free">Free</option>
                    <option value="premium">Plus</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={usersLoading}
                    onClick={() => void loadFirstUsersPage()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${usersLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    disabled={exportingUsersCsv}
                    onClick={async () => {
                      setExportingUsersCsv(true);
                      try {
                        const res = await exportUsersCsvAndLog({
                          roleFilter: userRoleFilter,
                          planFilter: userPlanFilter,
                          adminUid: adminProfile.uid,
                        });
                        const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `ainame-users-${new Date().toISOString().slice(0, 10)}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                        notify(`Exported ${res.count} users to CSV (logged)`, 'success');
                      } catch (err) {
                        notify(
                          err instanceof Error ? err.message : 'Failed to export users CSV.',
                          'error'
                        );
                      } finally {
                        setExportingUsersCsv(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exportingUsersCsv ? 'Exporting...' : 'Export CSV'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#13131c]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                    <tr>
                      <th className="p-3">Member</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Plan</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Joined</th>
                      <th className="p-3">Last Login</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {usersLoading && users.length === 0 ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          <td colSpan={7} className="p-3">
                            <div className="h-6 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                          </td>
                        </tr>
                      ))
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-zinc-500">
                          No members match the active filters.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const isSelf = u.uid === adminProfile.uid;
                        return (
                          <tr key={u.uid}>
                            <td className="p-3">
                              <p className="font-semibold">
                                {u.displayName}
                                {isSelf && (
                                  <span className="ml-1.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800">
                                    You
                                  </span>
                                )}
                              </p>
                              <p className="text-zinc-500">{u.email}</p>
                            </td>
                            <td className="p-3 capitalize">{u.role}</td>
                            <td className="p-3">
                              {u.plan === 'premium'
                                ? u.subscriptionPlanName || 'Premium'
                                : 'Free'}
                            </td>
                            <td className="p-3 capitalize">
                              <span
                                className={
                                  u.status === 'banned'
                                    ? 'font-semibold text-rose-500'
                                    : 'text-emerald-500'
                                }
                              >
                                {u.status}
                              </span>
                            </td>
                            <td className="font-mono-tabular p-3 text-zinc-500">
                              {u.createdAt?.slice(0, 10)}
                            </td>
                            <td className="font-mono-tabular p-3 text-zinc-500">
                              {formatRelativeTime(u.lastLoginAt)}
                            </td>
                            <td className="p-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPendingUserAction({ kind: 'plan', user: u })
                                  }
                                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] dark:border-zinc-700"
                                >
                                  {u.plan === 'premium' ? 'Set Free' : 'Grant Plus'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSelf && u.role === 'admin'}
                                  title={
                                    isSelf && u.role === 'admin'
                                      ? 'You cannot demote your own admin account'
                                      : undefined
                                  }
                                  onClick={() =>
                                    setPendingUserAction({ kind: 'role', user: u })
                                  }
                                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
                                >
                                  {u.role === 'admin' ? 'Demote' : 'Make Admin'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSelf}
                                  onClick={() =>
                                    setPendingUserAction({ kind: 'status', user: u })
                                  }
                                  className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-amber-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700"
                                >
                                  {u.status === 'banned' ? 'Unban' : 'Ban'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSelf}
                                  title={isSelf ? 'You cannot delete your own account' : undefined}
                                  onClick={() =>
                                    setPendingUserAction({ kind: 'delete', user: u })
                                  }
                                  aria-label={`Delete user ${u.displayName}`}
                                  className="rounded p-1 text-zinc-400 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {usersHasMore && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled={usersLoadingMore}
                    onClick={async () => {
                      if (!usersCursor || usersLoadingMore) return;
                      setUsersLoadingMore(true);
                      try {
                        const page = await fetchUsersPage({
                          roleFilter: userRoleFilter,
                          planFilter: userPlanFilter,
                          cursor: usersCursor,
                          pageSize: 25,
                        });
                        setUsers((prev) => {
                          const seen = new Set(prev.map((x) => x.uid));
                          return [...prev, ...page.items.filter((x) => !seen.has(x.uid))];
                        });
                        setUsersCursor(page.lastDoc);
                        setUsersHasMore(page.hasMore);
                      } catch (err) {
                        notify(
                          err instanceof Error ? err.message : 'Could not load next 25 users.',
                          'error'
                        );
                      } finally {
                        setUsersLoadingMore(false);
                      }
                    }}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {usersLoadingMore ? 'Loading...' : 'Load Next 25 Users'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 6B. BLOG CMS */}
          {activeTab === 'blog' && (
            <BlogManager
              adminUid={adminProfile.uid}
              onMutateSuccess={() => void refreshLiveMetrics()}
              onNotify={notify}
            />
          )}

          {/* 7. COMMENTS MODERATION */}
          {activeTab === 'comments' && (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
              <h2 className="mb-4 font-display text-base font-semibold">
                Comments Moderation ({comments.length})
              </h2>
              {comments.length === 0 ? (
                <p className="text-sm text-zinc-500">No comments in queue.</p>
              ) : (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {comments.map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                      <div>
                        <p className="text-xs text-zinc-500">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {c.userName}
                          </span>{' '}
                          on {moviesMap[c.movieId]?.title ?? c.movieId} ·{' '}
                          {formatRelativeTime(c.createdAt)}
                        </p>
                        <p className={`mt-1 ${c.isHidden ? 'line-through opacity-50' : ''}`}>
                          {c.text}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            await toggleCommentVisibility(c.id, !c.isHidden, adminProfile.uid);
                            setComments((prev) =>
                              prev.map((x) =>
                                x.id === c.id ? { ...x, isHidden: !c.isHidden } : x
                              )
                            );
                          }}
                          className="rounded p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                          aria-label={c.isHidden ? 'Unhide comment' : 'Hide comment'}
                        >
                          {c.isHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteCommentDoc(c.id);
                            setComments((prev) => prev.filter((x) => x.id !== c.id));
                            notify('Comment deleted', 'success');
                          }}
                          className="rounded p-1.5 text-zinc-400 hover:text-rose-500"
                          aria-label="Delete comment"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 8. REPORTS */}
          {activeTab === 'reports' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {(['all', 'open', 'resolved'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setReportFilter(status)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                      reportFilter === status
                        ? 'bg-[var(--kv-accent,#e50914)] text-white'
                        : 'border border-zinc-300 dark:border-zinc-700'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#13131c]">
                {filteredReports.length === 0 ? (
                  <p className="text-sm text-zinc-500">No reports matching this filter.</p>
                ) : (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {filteredReports.map((r) => {
                      const targetMovie = moviesMap[r.movieId];
                      return (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-4 py-3 text-sm"
                        >
                          <div>
                            <p className="text-xs text-zinc-500">
                              <span className="font-semibold text-zinc-900 dark:text-white">
                                {targetMovie?.title ?? r.movieId}
                              </span>{' '}
                              · {r.type} · {r.status} · {formatRelativeTime(r.createdAt)}
                            </p>
                            <p className="mt-1">{r.message}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {targetMovie && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMovie(targetMovie);
                                  setMovieModalOpen(true);
                                }}
                                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium dark:border-zinc-700"
                              >
                                Edit Source
                              </button>
                            )}
                            {r.status === 'open' && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateReportStatus(r.id, 'resolved', adminProfile.uid);
                                  setReports((prev) =>
                                    prev.map((x) =>
                                      x.id === r.id ? { ...x, status: 'resolved' } : x
                                    )
                                  );
                                  notify('Report marked resolved', 'success');
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Resolve
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 8A. AD UNLOCK & BADGES HUB */}
          {activeTab === 'ad_unlock' && (
            <AdUnlockAdminHub
              movies={movies}
              plans={plans}
              customAds={customAds}
              vastAds={vastAds}
              adEvents={adEvents}
              adSettings={adSettings}
              adminUid={adminProfile.uid}
              adminName={adminProfile.displayName || adminProfile.email}
              onUpdateMovie={(updated) =>
                setMovies((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
              }
              onSaveCustomAd={async (ad, isNew) => {
                await saveCustomAdDoc(ad, adminProfile.uid, isNew);
                setCustomAds((prev) =>
                  isNew ? [ad, ...prev] : prev.map((x) => (x.id === ad.id ? ad : x))
                );
                notify(isNew ? `Created ad "${ad.name}"` : `Updated ad "${ad.name}"`, 'success');
              }}
              onSaveVastAd={async (ad, isNew) => {
                await saveVastAdDoc(ad, adminProfile.uid, isNew);
                setVastAds((prev) =>
                  isNew ? [ad, ...prev] : prev.map((x) => (x.id === ad.id ? ad : x))
                );
                notify(isNew ? `Created VAST "${ad.name}"` : `Updated VAST "${ad.name}"`, 'success');
              }}
              onSaveAdSettings={async (next) => {
                await saveAdSettings(next, adminProfile.uid);
                setAdSettings(next);
                notify('Ad Unlock & Badge Settings saved', 'success');
              }}
              onSeedCatalog={async () => {
                await seedCatalogToFirestore(adminProfile.uid);
                await loadAllAdmin();
                notify('Sample catalog seeded to Firestore', 'success');
              }}
              onSeedSampleAds={async () => {
                await seedSampleAdsToFirestore(adminProfile.uid);
                const fresh = await fetchAllAdsAdminData();
                setCustomAds(fresh.customAds);
                setVastAds(fresh.vastAds);
                setAdSettings(fresh.adSettings);
                notify('Sample Custom & VAST Ads seeded to Firestore', 'success');
              }}
              onNotify={notify}
            />
          )}

          {/* 8B. ADVERTISING MODULE */}
          {activeTab.startsWith('ads_') && (
            <AdManagementHub
              section={activeTab.replace('ads_', '') as AdsSubSection}
              customAds={customAds}
              vastAds={vastAds}
              adEvents={adEvents}
              adSettings={adSettings}
              movies={movies}
              adminUid={adminProfile.uid}
              adminName={adminProfile.displayName || adminProfile.email}
              onSaveCustomAd={async (ad, isNew) => {
                await saveCustomAdDoc(ad, adminProfile.uid, isNew);
                setCustomAds((prev) =>
                  isNew ? [ad, ...prev] : prev.map((x) => (x.id === ad.id ? ad : x))
                );
                notify(isNew ? `Created ad "${ad.name}"` : `Updated ad "${ad.name}"`, 'success');
              }}
              onDeleteCustomAd={async (ad) => {
                await deleteCustomAdDoc(ad, adminProfile.uid);
                setCustomAds((prev) => prev.filter((x) => x.id !== ad.id));
                notify(`Deleted ad "${ad.name}"`, 'success');
              }}
              onSaveVastAd={async (ad, isNew) => {
                await saveVastAdDoc(ad, adminProfile.uid, isNew);
                setVastAds((prev) =>
                  isNew ? [ad, ...prev] : prev.map((x) => (x.id === ad.id ? ad : x))
                );
                notify(isNew ? `Created VAST "${ad.name}"` : `Updated VAST "${ad.name}"`, 'success');
              }}
              onDeleteVastAd={async (ad) => {
                await deleteVastAdDoc(ad, adminProfile.uid);
                setVastAds((prev) => prev.filter((x) => x.id !== ad.id));
                notify(`Deleted VAST "${ad.name}"`, 'success');
              }}
              onSaveAdSettings={async (next) => {
                await saveAdSettings(next, adminProfile.uid);
                setAdSettings(next);
                notify('Global Ad Settings saved', 'success');
              }}
              onSeedSampleAds={async () => {
                await seedSampleAdsToFirestore(adminProfile.uid);
                const fresh = await fetchAllAdsAdminData();
                setCustomAds(fresh.customAds);
                setVastAds(fresh.vastAds);
                setAdSettings(fresh.adSettings);
                notify('Sample Custom & VAST Ads seeded to Firestore', 'success');
              }}
              onNavigateSection={(sub) => setActiveTab(`ads_${sub}` as AdminTab)}
              onNotify={notify}
            />
          )}

          {/* 9. 11-TAB SITE CUSTOMIZATION & SETTINGS */}
          {activeTab === 'settings' && (
            <CustomizationHub
              settings={settings}
              movies={movies}
              pages={pages}
              messages={messages}
              saving={savingSettings}
              onChange={(updater) => setSettings(updater)}
              onSave={async (nextSettings) => {
                setSavingSettings(true);
                try {
                  await saveSiteSettingsDoc(nextSettings, adminProfile.uid);
                  setSettings(nextSettings);
                  notify('Site customization saved & published live!', 'success');
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Failed to save customization.', 'error');
                } finally {
                  setSavingSettings(false);
                }
              }}
              onSavePage={async (page, isNew) => {
                await saveCustomPageDoc(page, adminProfile.uid, isNew);
                setPages((prev) =>
                  isNew ? [...prev, page] : prev.map((p) => (p.id === page.id ? page : p))
                );
                notify(`Saved custom page "${page.title}"`, 'success');
              }}
              onDeletePage={async (pageId) => {
                await deleteCustomPageDoc(pageId, adminProfile.uid);
                setPages((prev) => prev.filter((p) => p.id !== pageId));
                notify('Deleted custom page', 'success');
              }}
              onUpdateMessageStatus={async (id, status) => {
                await updateContactMessageStatus(id, status, adminProfile.uid);
                setMessages((prev) =>
                  prev.map((m) => (m.id === id ? { ...m, status } : m))
                );
                notify(`Message marked ${status}`, 'success');
              }}
              onDeleteMessage={async (id) => {
                await deleteContactMessageDoc(id, adminProfile.uid);
                setMessages((prev) => prev.filter((m) => m.id !== id));
                notify('Deleted message', 'success');
              }}
              onNotify={notify}
            />
          )}

          {/* 10. ACTIVITY LOG */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <input
                type="search"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter audit logs..."
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
              />
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#13131c]">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                    <tr>
                      <th className="p-3">Action</th>
                      <th className="p-3">Target</th>
                      <th className="p-3">Admin UID</th>
                      <th className="p-3 text-right">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {filteredLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="p-3 font-medium">{l.action}</td>
                        <td className="font-mono p-3 text-zinc-500">{l.targetId}</td>
                        <td className="font-mono p-3 text-zinc-500">{l.adminUid.slice(0, 10)}…</td>
                        <td className="font-mono-tabular p-3 text-right text-zinc-500">
                          {formatRelativeTime(l.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Movie Form Modal */}
      <MovieFormModal
        open={movieModalOpen}
        initialMovie={editingMovie}
        genres={genres}
        plans={plans}
        tmdbApiKey={settings.tmdbApiKey}
        onClose={() => setMovieModalOpen(false)}
        onSave={async (movie, isNew) => {
          await saveMovieDoc(movie, adminProfile.uid, isNew);
          setMovies((prev) =>
            isNew ? [movie, ...prev] : prev.map((x) => (x.id === movie.id ? movie : x))
          );
          void refreshLiveMetrics();
          notify(isNew ? `Added "${movie.title}"` : `Updated "${movie.title}"`, 'success');
        }}
      />

      {/* Change Title Status Modal */}
      <Modal
        open={Boolean(statusModalMovie)}
        onClose={() => setStatusModalMovie(null)}
        title="Change Title Status"
        maxWidthClass="max-w-md"
      >
        {statusModalMovie && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSavingTitleStatus(true);
              try {
                const updated = await updateTitleStatusBatch({
                  movie: statusModalMovie,
                  status: statusModalValue,
                  adminUid: adminProfile.uid,
                });
                setMovies((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                setStatusModalMovie(null);
                void refreshLiveMetrics();
                notify(
                  `"${updated.title}" is now ${updated.status}`,
                  'success'
                );
              } catch (err) {
                notify(
                  err instanceof Error ? err.message : 'Could not update title status.',
                  'error'
                );
              } finally {
                setSavingTitleStatus(false);
              }
            }}
            className="space-y-4 text-sm"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Update visibility status for{' '}
              <span className="font-semibold text-zinc-900 dark:text-white">
                {statusModalMovie.title}
              </span>
              . Published titles count toward live KPIs and appear in the streaming catalog.
            </p>
            <div>
              <label htmlFor="title-status-select" className="mb-1 block text-xs text-zinc-500">
                Catalog Status
              </label>
              <select
                id="title-status-select"
                value={statusModalValue}
                onChange={(e) => setStatusModalValue(e.target.value as TitleStatus)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="published">Published (Live in Catalog)</option>
                <option value="draft">Draft (Hidden from Viewers)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStatusModalMovie(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingTitleStatus}
                className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingTitleStatus ? 'Saving...' : 'Save Status'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Update Plan Pricing Modal */}
      <Modal
        open={Boolean(pricingPlan)}
        onClose={() => setPricingPlan(null)}
        title="Update Plan Pricing"
        maxWidthClass="max-w-md"
      >
        {pricingPlan && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const parsed = Number(pricingAmount);
              if (!Number.isFinite(parsed) || parsed <= 0 || !hasMaxTwoDecimals(parsed)) {
                notify('Enter a valid monthly price greater than 0 (max 2 decimals).', 'error');
                return;
              }
              setSavingPricing(true);
              try {
                const updated = await updatePlanPricingBatch({
                  plan: pricingPlan,
                  pricePerMonth: parsed,
                  currency: pricingCurrency,
                  isActive: pricingActive,
                  adminUid: adminProfile.uid,
                });
                setPlans((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                setPricingPlan(null);
                notify(
                  `Updated pricing for "${updated.name}" to ${formatMonthlyPrice(
                    updated.pricePerMonth,
                    updated.currency
                  )}`,
                  'success'
                );
              } catch (err) {
                notify(
                  err instanceof Error ? err.message : 'Could not update plan pricing.',
                  'error'
                );
              } finally {
                setSavingPricing(false);
              }
            }}
            className="space-y-4 text-sm"
          >
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Plan: <span className="font-semibold text-zinc-900 dark:text-white">{pricingPlan.name}</span>.
              Updates apply atomically and write an audit log entry.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="quick-plan-price" className="mb-1 block text-xs text-zinc-500">
                  Monthly Price
                </label>
                <input
                  id="quick-plan-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={pricingAmount}
                  onChange={(e) => setPricingAmount(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm tabular-nums dark:border-zinc-700"
                />
              </div>
              <div>
                <label htmlFor="quick-plan-currency" className="mb-1 block text-xs text-zinc-500">
                  Currency
                </label>
                <select
                  id="quick-plan-currency"
                  value={pricingCurrency}
                  onChange={(e) => setPricingCurrency(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="INR">INR</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={pricingActive}
                onChange={(e) => setPricingActive(e.target.checked)}
                className="accent-[var(--kv-accent,#e50914)]"
              />
              <span>Active (visible to users)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPricingPlan(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPricing}
                className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingPricing ? 'Updating...' : 'Save Pricing'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Plan Confirm */}
      <ConfirmDialog
        open={Boolean(deletingPlan)}
        title="Delete Subscription Plan"
        message={`Delete "${deletingPlan?.name}"? Existing orders keep their historical plan snapshot, and assigned titles will no longer reference this plan.`}
        confirmLabel="Delete Plan"
        danger
        onCancel={() => setDeletingPlan(null)}
        onConfirm={async () => {
          if (!deletingPlan) return;
          await deletePlanDoc(deletingPlan.id, adminProfile.uid);
          setPlans((prev) => prev.filter((x) => x.id !== deletingPlan.id));
          notify(`Deleted plan "${deletingPlan.name}"`, 'success');
          setDeletingPlan(null);
        }}
      />

      {/* User Mutation Confirm */}
      <ConfirmDialog
        open={Boolean(pendingUserAction)}
        title={
          pendingUserAction?.kind === 'delete'
            ? 'Delete User Account'
            : pendingUserAction?.kind === 'role'
            ? pendingUserAction.user.role === 'admin'
              ? 'Demote Administrator'
              : 'Promote to Administrator'
            : pendingUserAction?.kind === 'status'
            ? pendingUserAction.user.status === 'banned'
              ? 'Unban Member'
              : 'Ban Member'
            : pendingUserAction?.user.plan === 'premium'
            ? 'Revoke Plus Subscription'
            : 'Grant Plus Access'
        }
        message={
          pendingUserAction
            ? pendingUserAction.kind === 'delete'
              ? `Permanently delete user document for "${pendingUserAction.user.displayName}" (${pendingUserAction.user.email})? This action is logged and cannot be undone.`
              : pendingUserAction.kind === 'role'
              ? `Change role for "${pendingUserAction.user.displayName}" from ${pendingUserAction.user.role} to ${
                  pendingUserAction.user.role === 'admin' ? 'user' : 'admin'
                }?`
              : pendingUserAction.kind === 'status'
              ? `${pendingUserAction.user.status === 'banned' ? 'Restore access for' : 'Ban'} "${
                  pendingUserAction.user.displayName
                }"?`
              : `${pendingUserAction.user.plan === 'premium' ? 'Set plan to Free for' : 'Grant Plus access to'} "${
                  pendingUserAction.user.displayName
                }"?`
            : ''
        }
        confirmLabel={
          userActionBusy
            ? 'Applying...'
            : pendingUserAction?.kind === 'delete'
            ? 'Delete User'
            : 'Confirm Change'
        }
        danger={
          pendingUserAction?.kind === 'delete' ||
          (pendingUserAction?.kind === 'status' && pendingUserAction.user.status !== 'banned')
        }
        onCancel={() => {
          if (!userActionBusy) setPendingUserAction(null);
        }}
        onConfirm={async () => {
          if (!pendingUserAction || userActionBusy) return;
          const target = pendingUserAction.user;
          setUserActionBusy(true);
          try {
            if (pendingUserAction.kind === 'delete') {
              await deleteAdminUserBatch({
                targetUid: target.uid,
                adminUid: adminProfile.uid,
              });
              setUsers((prev) => prev.filter((x) => x.uid !== target.uid));
              notify(`Deleted user "${target.displayName}"`, 'success');
            } else if (pendingUserAction.kind === 'plan') {
              const nextPlan = target.plan === 'premium' ? 'free' : 'premium';
              const expiry =
                nextPlan === 'premium'
                  ? new Date(Date.now() + 30 * 86400_000).toISOString()
                  : null;
              await updateAdminUserBatch({
                targetUid: target.uid,
                updates: {
                  plan: nextPlan,
                  planExpiresAt: expiry,
                  ...(nextPlan === 'free'
                    ? { subscriptionPlanId: null, subscriptionPlanName: null }
                    : {}),
                },
                adminUid: adminProfile.uid,
                action: `admin_set_user_plan:${nextPlan}`,
              });
              setUsers((prev) =>
                prev.map((x) =>
                  x.uid === target.uid
                    ? {
                        ...x,
                        plan: nextPlan,
                        planExpiresAt: expiry,
                        ...(nextPlan === 'free'
                          ? { subscriptionPlanId: null, subscriptionPlanName: null }
                          : {}),
                      }
                    : x
                )
              );
              notify(`Set ${target.displayName} plan to ${nextPlan}`, 'success');
            } else if (pendingUserAction.kind === 'role') {
              const nextRole = target.role === 'admin' ? 'user' : 'admin';
              await updateAdminUserBatch({
                targetUid: target.uid,
                updates: { role: nextRole },
                adminUid: adminProfile.uid,
                action: `admin_set_user_role:${nextRole}`,
              });
              setUsers((prev) =>
                prev.map((x) => (x.uid === target.uid ? { ...x, role: nextRole } : x))
              );
              notify(`Changed ${target.displayName} role to ${nextRole}`, 'success');
            } else if (pendingUserAction.kind === 'status') {
              const nextStatus = target.status === 'banned' ? 'active' : 'banned';
              await updateAdminUserBatch({
                targetUid: target.uid,
                updates: { status: nextStatus },
                adminUid: adminProfile.uid,
                action: `admin_set_user_status:${nextStatus}`,
              });
              setUsers((prev) =>
                prev.map((x) => (x.uid === target.uid ? { ...x, status: nextStatus } : x))
              );
              notify(`Updated ${target.displayName} status to ${nextStatus}`, 'info');
            }
            setPendingUserAction(null);
            void refreshLiveMetrics();
          } catch (err) {
            notify(err instanceof Error ? err.message : 'User update failed.', 'error');
          } finally {
            setUserActionBusy(false);
          }
        }}
      />

      {/* Delete Movie Confirm */}
      <ConfirmDialog
        open={Boolean(deletingMovie)}
        title="Delete Title"
        message={`Are you sure you want to permanently delete "${deletingMovie?.title}"?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeletingMovie(null)}
        onConfirm={async () => {
          if (!deletingMovie) return;
          await deleteMovieDoc(deletingMovie.id, adminProfile.uid);
          setMovies((prev) => prev.filter((x) => x.id !== deletingMovie.id));
          void refreshLiveMetrics();
          notify(`Deleted "${deletingMovie.title}"`, 'success');
          setDeletingMovie(null);
        }}
      />
    </div>
  );
}

export default function AdminApp() {
  return (
    <ToastProvider>
      <AdminShell />
    </ToastProvider>
  );
}
