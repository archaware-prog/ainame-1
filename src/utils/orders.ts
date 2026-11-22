import type {
  BlogPostItem,
  OrderItem,
  OrderPaymentMethod,
  OrderPaymentStatus,
} from '../types/streaming';

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function hasMaxTwoDecimals(value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

export function formatCurrencyAmount(amount: number, currency = 'USD'): string {
  const safe = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  const code = (currency || 'USD').trim().toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe);
  } catch {
    return `${code} ${safe.toFixed(2)}`;
  }
}

export function isValidOrderTransition(
  from: OrderPaymentStatus,
  to: OrderPaymentStatus
): boolean {
  if (from === 'pending') return to === 'paid' || to === 'failed';
  if (from === 'failed') return to === 'pending';
  if (from === 'paid') return to === 'refunded';
  return false;
}

export interface OrderDraftInput {
  userId?: string;
  userEmail?: string;
  userName?: string;
  planId?: string;
  planName?: string;
  amount?: number;
  currency?: string;
  paymentMethod?: OrderPaymentMethod;
  reference?: string | null;
}

export function validateOrderDraft(draft: OrderDraftInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.userId || !draft.userId.trim()) errors.userId = 'Member is required.';
  if (!draft.userEmail || !draft.userEmail.trim()) errors.userEmail = 'Member email is required.';
  if (!draft.userName || !draft.userName.trim()) errors.userName = 'Member name is required.';
  if (!draft.planId || !draft.planId.trim()) errors.planId = 'Subscription plan is required.';
  if (!draft.planName || !draft.planName.trim()) errors.planName = 'Plan name is required.';

  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000) {
    errors.amount = 'Amount must be between 0 and 10,000.';
  } else if (!hasMaxTwoDecimals(amount)) {
    errors.amount = 'Amount may have at most 2 decimal places.';
  }

  if (!draft.currency || draft.currency.trim().length < 1 || draft.currency.trim().length > 10) {
    errors.currency = 'Currency is required.';
  }

  const allowedMethods: OrderPaymentMethod[] = ['manual', 'upi', 'card', 'other'];
  if (!draft.paymentMethod || !allowedMethods.includes(draft.paymentMethod)) {
    errors.paymentMethod = 'Select a valid payment method.';
  }

  if (draft.reference && draft.reference.trim().length > 100) {
    errors.reference = 'Reference ID must be 100 characters or fewer.';
  }

  return errors;
}

export function computeLocalStartOfTodayIso(now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString();
}

export function computeSevenDaysAgoIso(now = new Date()): string {
  return new Date(now.getTime() - 7 * 86400_000).toISOString();
}

export function exportOrdersToCsv(orders: OrderItem[]): string {
  const headers = [
    'Order ID',
    'User ID',
    'Name',
    'Email',
    'Plan ID',
    'Plan Name',
    'Amount',
    'Currency',
    'Payment Status',
    'Payment Method',
    'Reference',
    'Created At',
    'Paid At',
    'Updated At',
  ];
  const escapeCell = (val: string | number | null | undefined) =>
    `"${String(val ?? '').replace(/"/g, '""')}"`;

  const rows = orders.map((o) =>
    [
      o.id,
      o.userId,
      o.userName,
      o.userEmail,
      o.planId,
      o.planName,
      roundCurrency(o.amount).toFixed(2),
      o.currency,
      o.paymentStatus,
      o.paymentMethod,
      o.reference ?? '',
      o.createdAt,
      o.paidAt ?? '',
      o.updatedAt,
    ]
      .map(escapeCell)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function validateBlogPostDraft(draft: Partial<BlogPostItem>): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = (draft.title ?? '').trim();
  const slug = (draft.slug ?? '').trim();
  const excerpt = (draft.excerpt ?? '').trim();
  const contentHtml = (draft.contentHtml ?? '').trim();
  const coverUrl = (draft.coverUrl ?? '').trim();

  if (!title) errors.title = 'Post title is required.';
  else if (title.length > 160) errors.title = 'Title must be 160 characters or fewer.';

  if (!slug) errors.slug = 'URL slug is required.';
  else if (!/^[a-z0-9-]+$/.test(slug) || slug.length > 100) {
    errors.slug = 'Slug may only contain lowercase letters, numbers, and hyphens (max 100 chars).';
  }

  if (!excerpt) errors.excerpt = 'Excerpt is required.';
  else if (excerpt.length > 500) errors.excerpt = 'Excerpt must be 500 characters or fewer.';

  if (!contentHtml) errors.contentHtml = 'Post body content is required.';
  else if (contentHtml.length > 50000) errors.contentHtml = 'Post content exceeds 50,000 characters.';

  if (coverUrl && coverUrl.length > 1500) {
    errors.coverUrl = 'Cover URL must be 1500 characters or fewer.';
  }

  return errors;
}
