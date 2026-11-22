import {
  collection,
  doc,
  getAggregateFromServer,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  sum,
  where,
  writeBatch,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  AdminLiveMetrics,
  BlogPostItem,
  BlogPostStatus,
  MovieItem,
  OrderItem,
  OrderPaymentMethod,
  OrderPaymentStatus,
  SubscriptionPlan,
  TitleStatus,
  UserPlan,
  UserProfile,
  UserRole,
} from '../types/streaming';
import {
  computeLocalStartOfTodayIso,
  computeSevenDaysAgoIso,
  exportOrdersToCsv,
  isValidOrderTransition,
  roundCurrency,
} from '../utils/orders';
import { exportUsersToCsv } from '../utils/catalog';
import { sanitizeHtml } from '../utils/customization';

export interface PaginatedResult<T> {
  items: T[];
  lastDoc: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

function makeLogId(prefix = 'log'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function appendActivityLogToBatch(
  batch: WriteBatch,
  adminUid: string,
  action: string,
  targetId: string,
  createdAt = new Date().toISOString()
): void {
  const logRef = doc(db, 'activityLogs', makeLogId());
  batch.set(logRef, {
    adminUid,
    action: action.slice(0, 200),
    targetId: targetId.slice(0, 128),
    createdAt,
  });
}

// ============================================================================
// USER-SIDE ORDERS & PUBLISHED POSTS
// ============================================================================

/**
 * TODO (Payment Gateway Webhook):
 * In production, wire a server-side webhook endpoint (e.g., Razorpay or Stripe
 * Cloud Function / Express `/api/webhooks/payment`) that verifies the gateway's
 * cryptographic signature, checks `amount` and `currency`, and atomically transitions
 * `orders/{orderId}` from `pending` -> `paid` (`paidAt`, `updatedAt`) while upgrading
 * `users/{uid}` to `plan: 'premium'`. Never confirm payments from browser callbacks.
 */
export async function createPendingOrder(params: {
  user: UserProfile;
  plan: SubscriptionPlan;
  paymentMethod?: OrderPaymentMethod;
  reference?: string | null;
}): Promise<OrderItem> {
  const { user, plan, paymentMethod = 'manual', reference } = params;
  const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  const cleanRef = reference?.trim().slice(0, 100) || null;
  const payload: Omit<OrderItem, 'id'> = {
    userId: user.uid,
    userEmail: user.email,
    userName: user.displayName,
    planId: plan.id,
    planName: plan.name,
    amount: roundCurrency(plan.pricePerMonth),
    currency: plan.currency.trim().toUpperCase(),
    paymentStatus: 'pending',
    paymentMethod,
    ...(cleanRef ? { reference: cleanRef } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  try {
    await setDoc(doc(db, 'orders', orderId), payload);
    return { id: orderId, ...payload };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${orderId}`);
  }
}

export function subscribeToUserOrders(
  uid: string,
  onData: (orders: OrderItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'orders'),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(25)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<OrderItem, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeToPublishedPosts(
  onData: (posts: BlogPostItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'posts'),
    where('status', '==', 'published'),
    orderBy('publishedAt', 'desc'),
    limit(20)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<BlogPostItem, 'id'>),
      }));
      onData(items);
    },
    (error) => {
      onError?.(error);
    }
  );
}

// ============================================================================
// ADMIN REAL-TIME DASHBOARD AGGREGATES & LISTENERS
// ============================================================================

export interface AdminAggregateSnapshot extends AdminLiveMetrics {
  premiumUsersCount: number;
  freeUsersCount: number;
}

export async function fetchAdminAggregateMetrics(): Promise<AdminAggregateSnapshot> {
  const todayStartIso = computeLocalStartOfTodayIso();
  const sevenDaysAgoIso = computeSevenDaysAgoIso();

  try {
    const [
      publishedTitlesSnap,
      totalStudentsSnap,
      newStudents7dSnap,
      premiumUsersSnap,
      paidRevenueSnap,
      refundedRevenueSnap,
      newOrdersTodaySnap,
      pendingOrdersSnap,
    ] = await Promise.all([
      getCountFromServer(query(collection(db, 'movies'), where('status', '==', 'published'))),
      getCountFromServer(query(collection(db, 'users'), where('role', '==', 'user'))),
      getCountFromServer(
        query(
          collection(db, 'users'),
          where('role', '==', 'user'),
          where('createdAt', '>=', sevenDaysAgoIso)
        )
      ),
      getCountFromServer(query(collection(db, 'users'), where('plan', '==', 'premium'))),
      getAggregateFromServer(
        query(collection(db, 'orders'), where('paymentStatus', '==', 'paid')),
        { totalRevenue: sum('amount') }
      ),
      getAggregateFromServer(
        query(collection(db, 'orders'), where('paymentStatus', '==', 'refunded')),
        { refundedTotal: sum('amount') }
      ),
      getCountFromServer(
        query(collection(db, 'orders'), where('createdAt', '>=', todayStartIso))
      ),
      getCountFromServer(
        query(collection(db, 'orders'), where('paymentStatus', '==', 'pending'))
      ),
    ]);

    const totalStudents = totalStudentsSnap.data().count;
    const premiumUsersCount = premiumUsersSnap.data().count;

    return {
      publishedTitles: publishedTitlesSnap.data().count,
      totalStudents,
      newStudents7d: newStudents7dSnap.data().count,
      premiumUsersCount,
      freeUsersCount: Math.max(0, totalStudents - premiumUsersCount),
      totalRevenue: roundCurrency(Number(paidRevenueSnap.data().totalRevenue || 0)),
      refundedTotal: roundCurrency(Number(refundedRevenueSnap.data().refundedTotal || 0)),
      primaryCurrency: 'USD',
      newOrdersToday: newOrdersTodaySnap.data().count,
      pendingOrdersCount: pendingOrdersSnap.data().count,
      lastUpdatedAt: new Date().toISOString(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admin/aggregates');
  }
}

export function subscribeToRecentPaidSales(
  onData: (orders: OrderItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'orders'),
    where('paymentStatus', '==', 'paid'),
    orderBy('paidAt', 'desc'),
    limit(5)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<OrderItem, 'id'>),
        }))
      );
    },
    (err) => onError?.(err)
  );
}

export function subscribeToPendingOrders(
  onData: (count: number, pendingOrders: OrderItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'orders'),
    where('paymentStatus', '==', 'pending'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<OrderItem, 'id'>),
      }));
      onData(items.length, items);
    },
    (err) => onError?.(err)
  );
}

// ============================================================================
// CURSOR-PAGINATED ORDERS & USERS + CSV EXPORTS
// ============================================================================

export async function fetchOrdersPage(options: {
  statusFilter?: OrderPaymentStatus | 'all';
  cursor?: QueryDocumentSnapshot | null;
  pageSize?: number;
}): Promise<PaginatedResult<OrderItem>> {
  const { statusFilter = 'all', cursor = null, pageSize = 25 } = options;
  const constraints: QueryConstraint[] = [];
  if (statusFilter !== 'all') {
    constraints.push(where('paymentStatus', '==', statusFilter));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  if (cursor) {
    constraints.push(startAfter(cursor));
  }
  constraints.push(limit(pageSize + 1));

  try {
    const snap = await getDocs(query(collection(db, 'orders'), ...constraints));
    const hasMore = snap.docs.length > pageSize;
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
    return {
      items: docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderItem, 'id'>) })),
      lastDoc: docs[docs.length - 1] ?? null,
      hasMore,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'orders');
  }
}

export async function fetchUsersPage(options: {
  roleFilter?: UserRole | 'all';
  planFilter?: UserPlan | 'all';
  cursor?: QueryDocumentSnapshot | null;
  pageSize?: number;
}): Promise<PaginatedResult<UserProfile>> {
  const { roleFilter = 'all', planFilter = 'all', cursor = null, pageSize = 25 } = options;
  const constraints: QueryConstraint[] = [];
  if (roleFilter !== 'all') {
    constraints.push(where('role', '==', roleFilter));
  }
  if (planFilter !== 'all') {
    constraints.push(where('plan', '==', planFilter));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  if (cursor) {
    constraints.push(startAfter(cursor));
  }
  constraints.push(limit(pageSize + 1));

  try {
    const snap = await getDocs(query(collection(db, 'users'), ...constraints));
    const hasMore = snap.docs.length > pageSize;
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
    return {
      items: docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) })),
      lastDoc: docs[docs.length - 1] ?? null,
      hasMore,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function exportOrdersCsvAndLog(params: {
  statusFilter: OrderPaymentStatus | 'all';
  adminUid: string;
}): Promise<{ csv: string; count: number }> {
  const { statusFilter, adminUid } = params;
  const collected: OrderItem[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  const MAX_ROWS = 2000;

  try {
    while (collected.length < MAX_ROWS) {
      const page = await fetchOrdersPage({ statusFilter, cursor, pageSize: 100 });
      collected.push(...page.items);
      if (!page.hasMore || !page.lastDoc) break;
      cursor = page.lastDoc;
    }

    const batch = writeBatch(db);
    appendActivityLogToBatch(
      batch,
      adminUid,
      `export_orders_csv (${collected.length} rows)`,
      statusFilter
    );
    await batch.commit();

    return {
      csv: exportOrdersToCsv(collected),
      count: collected.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'orders/export');
  }
}

export async function exportUsersCsvAndLog(params: {
  roleFilter: UserRole | 'all';
  planFilter: UserPlan | 'all';
  adminUid: string;
}): Promise<{ csv: string; count: number }> {
  const { roleFilter, planFilter, adminUid } = params;
  const collected: UserProfile[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  const MAX_ROWS = 2000;

  try {
    while (collected.length < MAX_ROWS) {
      const page = await fetchUsersPage({ roleFilter, planFilter, cursor, pageSize: 100 });
      collected.push(...page.items);
      if (!page.hasMore || !page.lastDoc) break;
      cursor = page.lastDoc;
    }

    const batch = writeBatch(db);
    appendActivityLogToBatch(
      batch,
      adminUid,
      `export_users_csv (${collected.length} rows)`,
      `${roleFilter}:${planFilter}`
    );
    await batch.commit();

    return {
      csv: exportUsersToCsv(collected),
      count: collected.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users/export');
  }
}

// ============================================================================
// ATOMIC ADMIN BATCH MUTATIONS (ALL LOGGED IN SAME writeBatch)
// ============================================================================

export async function markOrderPaidBatch(params: {
  order: OrderItem;
  adminUid: string;
  paymentMethod: OrderPaymentMethod;
  reference?: string;
}): Promise<OrderItem> {
  const { order, adminUid, paymentMethod, reference } = params;
  if (!isValidOrderTransition(order.paymentStatus, 'paid')) {
    throw new Error(`Cannot mark order ${order.paymentStatus} as paid.`);
  }
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
  const cleanRef = reference?.trim().slice(0, 100) || null;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      paymentStatus: 'paid',
      paymentMethod,
      reference: cleanRef,
      paidAt: nowIso,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'users', order.userId), {
      plan: 'premium',
      subscriptionPlanId: order.planId,
      subscriptionPlanName: order.planName,
      planExpiresAt: expiresAt,
      lastLoginAt: nowIso,
    });
    appendActivityLogToBatch(batch, adminUid, 'mark_order_paid', order.id, nowIso);
    await batch.commit();

    return {
      ...order,
      paymentStatus: 'paid',
      paymentMethod,
      reference: cleanRef,
      paidAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function markOrderFailedBatch(params: {
  order: OrderItem;
  adminUid: string;
  reference?: string;
}): Promise<OrderItem> {
  const { order, adminUid, reference } = params;
  if (!isValidOrderTransition(order.paymentStatus, 'failed')) {
    throw new Error(`Cannot mark order ${order.paymentStatus} as failed.`);
  }
  const nowIso = new Date().toISOString();
  const cleanRef = reference?.trim().slice(0, 100) || order.reference || null;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      paymentStatus: 'failed',
      reference: cleanRef,
      updatedAt: nowIso,
    });
    appendActivityLogToBatch(batch, adminUid, 'mark_order_failed', order.id, nowIso);
    await batch.commit();

    return {
      ...order,
      paymentStatus: 'failed',
      reference: cleanRef,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function retryFailedOrderBatch(params: {
  order: OrderItem;
  adminUid: string;
}): Promise<OrderItem> {
  const { order, adminUid } = params;
  if (!isValidOrderTransition(order.paymentStatus, 'pending')) {
    throw new Error(`Cannot move order from ${order.paymentStatus} back to pending.`);
  }
  const nowIso = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      paymentStatus: 'pending',
      updatedAt: nowIso,
    });
    appendActivityLogToBatch(batch, adminUid, 'reopen_failed_order', order.id, nowIso);
    await batch.commit();

    return {
      ...order,
      paymentStatus: 'pending',
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function refundOrderBatch(params: {
  order: OrderItem;
  adminUid: string;
  reference?: string;
}): Promise<OrderItem> {
  const { order, adminUid, reference } = params;
  if (!isValidOrderTransition(order.paymentStatus, 'refunded')) {
    throw new Error(`Cannot refund an order in "${order.paymentStatus}" status.`);
  }
  const nowIso = new Date().toISOString();
  const cleanRef = reference?.trim().slice(0, 100) || order.reference || null;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      paymentStatus: 'refunded',
      reference: cleanRef,
      updatedAt: nowIso,
    });
    batch.update(doc(db, 'users', order.userId), {
      plan: 'free',
      subscriptionPlanId: null,
      subscriptionPlanName: null,
      planExpiresAt: null,
      lastLoginAt: nowIso,
    });
    appendActivityLogToBatch(batch, adminUid, 'refund_order', order.id, nowIso);
    await batch.commit();

    return {
      ...order,
      paymentStatus: 'refunded',
      reference: cleanRef,
      updatedAt: nowIso,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function createManualPaidOrderBatch(params: {
  user: UserProfile;
  plan: SubscriptionPlan;
  paymentMethod: OrderPaymentMethod;
  reference?: string;
  adminUid: string;
}): Promise<OrderItem> {
  const { user, plan, paymentMethod, reference, adminUid } = params;
  const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
  const cleanRef = reference?.trim().slice(0, 100) || null;

  const orderData: Omit<OrderItem, 'id'> = {
    userId: user.uid,
    userEmail: user.email,
    userName: user.displayName,
    planId: plan.id,
    planName: plan.name,
    amount: roundCurrency(plan.pricePerMonth),
    currency: plan.currency.trim().toUpperCase(),
    paymentStatus: 'paid',
    paymentMethod,
    ...(cleanRef ? { reference: cleanRef } : {}),
    createdAt: nowIso,
    paidAt: nowIso,
    updatedAt: nowIso,
  };

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'orders', orderId), orderData);
    batch.update(doc(db, 'users', user.uid), {
      plan: 'premium',
      subscriptionPlanId: plan.id,
      subscriptionPlanName: plan.name,
      planExpiresAt: expiresAt,
      lastLoginAt: nowIso,
    });
    appendActivityLogToBatch(batch, adminUid, 'create_manual_paid_order', orderId, nowIso);
    await batch.commit();

    return { id: orderId, ...orderData };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${orderId}`);
  }
}

export async function updateTitleStatusBatch(params: {
  movie: MovieItem;
  status: TitleStatus;
  adminUid: string;
}): Promise<MovieItem> {
  const { movie, status, adminUid } = params;
  const nowIso = new Date().toISOString();
  const updated: MovieItem = { ...movie, status, updatedAt: nowIso };
  const { id, ...rest } = updated;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'movies', id), rest);
    appendActivityLogToBatch(batch, adminUid, `change_title_status:${status}`, id, nowIso);
    await batch.commit();
    return updated;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `movies/${id}`);
  }
}

export async function updatePlanPricingBatch(params: {
  plan: SubscriptionPlan;
  pricePerMonth: number;
  currency: string;
  isActive: boolean;
  adminUid: string;
}): Promise<SubscriptionPlan> {
  const { plan, pricePerMonth, currency, isActive, adminUid } = params;
  const nowIso = new Date().toISOString();
  const updated: SubscriptionPlan = {
    ...plan,
    pricePerMonth: roundCurrency(pricePerMonth),
    currency: currency.trim().toUpperCase(),
    isActive,
    updatedAt: nowIso,
  };
  const { id, ...rest } = updated;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'plans', id), rest);
    appendActivityLogToBatch(
      batch,
      adminUid,
      `update_plan_pricing:${updated.currency} ${updated.pricePerMonth}`,
      id,
      nowIso
    );
    await batch.commit();
    return updated;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `plans/${id}`);
  }
}

export async function updateAdminUserBatch(params: {
  targetUid: string;
  updates: Partial<UserProfile>;
  adminUid: string;
  action: string;
}): Promise<void> {
  const { targetUid, updates, adminUid, action } = params;
  const { uid: _omit, ...rest } = updates;
  const nowIso = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', targetUid), rest);
    appendActivityLogToBatch(batch, adminUid, action, targetUid, nowIso);
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUid}`);
  }
}

export async function deleteAdminUserBatch(params: {
  targetUid: string;
  adminUid: string;
}): Promise<void> {
  const { targetUid, adminUid } = params;
  const nowIso = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', targetUid));
    appendActivityLogToBatch(batch, adminUid, 'delete_user', targetUid, nowIso);
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${targetUid}`);
  }
}

// ============================================================================
// BLOG CMS (posts/{postId})
// ============================================================================

export async function fetchBlogPostsPage(options: {
  statusFilter?: BlogPostStatus | 'all';
  cursor?: QueryDocumentSnapshot | null;
  pageSize?: number;
}): Promise<PaginatedResult<BlogPostItem>> {
  const { statusFilter = 'all', cursor = null, pageSize = 25 } = options;
  const constraints: QueryConstraint[] = [];
  if (statusFilter !== 'all') {
    constraints.push(where('status', '==', statusFilter));
  }
  constraints.push(orderBy('createdAt', 'desc'));
  if (cursor) {
    constraints.push(startAfter(cursor));
  }
  constraints.push(limit(pageSize + 1));

  try {
    const snap = await getDocs(query(collection(db, 'posts'), ...constraints));
    const hasMore = snap.docs.length > pageSize;
    const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs;
    return {
      items: docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlogPostItem, 'id'>) })),
      lastDoc: docs[docs.length - 1] ?? null,
      hasMore,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function saveBlogPostBatch(params: {
  post: BlogPostItem;
  isNew: boolean;
  adminUid: string;
}): Promise<BlogPostItem> {
  const { post, isNew, adminUid } = params;
  const nowIso = new Date().toISOString();
  const cleanPost: BlogPostItem = {
    ...post,
    title: post.title.trim().slice(0, 160),
    slug: post.slug.trim().slice(0, 100),
    excerpt: post.excerpt.trim().slice(0, 500),
    contentHtml: sanitizeHtml(post.contentHtml).slice(0, 50000),
    coverUrl: post.coverUrl?.trim() ? post.coverUrl.trim().slice(0, 1500) : null,
    updatedAt: nowIso,
    publishedAt:
      post.status === 'published' ? post.publishedAt || nowIso : null,
  };
  const { id, ...rest } = cleanPost;

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'posts', id), rest);
    appendActivityLogToBatch(
      batch,
      adminUid,
      isNew ? `create_blog_post:${cleanPost.status}` : `update_blog_post:${cleanPost.status}`,
      id,
      nowIso
    );
    await batch.commit();
    return cleanPost;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `posts/${id}`);
  }
}

export async function deleteBlogPostBatch(params: {
  postId: string;
  adminUid: string;
}): Promise<void> {
  const { postId, adminUid } = params;
  const nowIso = new Date().toISOString();

  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', postId));
    appendActivityLogToBatch(batch, adminUid, 'delete_blog_post', postId, nowIso);
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `posts/${postId}`);
  }
}
