import React, { useState } from 'react';
import {
  Check,
  Clock,
  Crown,
  Film,
  Lock,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import type {
  MovieItem,
  OrderItem,
  OrderPaymentMethod,
  SubscriptionPlan,
  UserProfile,
} from '../../types/streaming';
import { formatMonthlyPrice, formatRelativeTime } from '../../utils/catalog';
import { formatCurrencyAmount } from '../../utils/orders';
import { ConfirmDialog, Modal } from '../ui/Modal';

interface SubscriptionsViewProps {
  plans: SubscriptionPlan[];
  movies: MovieItem[];
  user: UserProfile | null;
  orders?: OrderItem[];
  highlightedPlanId?: string;
  onRequestSubscription: (
    plan: SubscriptionPlan,
    paymentMethod: OrderPaymentMethod,
    reference?: string
  ) => Promise<void>;
  onCancelSubscription: () => Promise<void>;
  onOpenAuth: () => void;
  onSelectMovie: (movie: MovieItem) => void;
}

const ORDER_STATUS_STYLES: Record<OrderItem['paymentStatus'], string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  paid: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  refunded: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

export function SubscriptionsView({
  plans,
  movies,
  user,
  orders = [],
  highlightedPlanId,
  onRequestSubscription,
  onCancelSubscription,
  onOpenAuth,
  onSelectMovie,
}: SubscriptionsViewProps) {
  const [confirmPlan, setConfirmPlan] = useState<SubscriptionPlan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>('manual');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestBanner, setRequestBanner] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const activePlans = plans.filter((p) => p.isActive).sort((a, b) => a.order - b.order);
  const currentPlanId = user?.plan === 'premium' ? user.subscriptionPlanId : null;
  const isExpired = Boolean(
    user?.planExpiresAt &&
      !Number.isNaN(Date.parse(user.planExpiresAt)) &&
      Date.parse(user.planExpiresAt) < Date.now()
  );

  const pendingPlanIds = new Set(
    orders.filter((o) => o.paymentStatus === 'pending').map((o) => o.planId)
  );

  const handleChoosePlan = (plan: SubscriptionPlan) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    setPaymentMethod('manual');
    setReference('');
    setConfirmPlan(plan);
  };

  const handleConfirmRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmPlan) return;
    setSubmitting(true);
    try {
      await onRequestSubscription(confirmPlan, paymentMethod, reference.trim() || undefined);
      setConfirmPlan(null);
      setRequestBanner('Request sent, waiting for admin confirmation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    setCanceling(true);
    try {
      await onCancelSubscription();
      setCancelOpen(false);
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-zinc-200 pb-8 dark:border-zinc-800">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-500">
            <Crown className="h-4 w-4" />
            <span>Monthly Membership Plans</span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-zinc-950 dark:text-white sm:text-4xl">
            Unlock Exclusive Titles by Plan
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Select a monthly subscription tier to submit an upgrade request. Once payment is
            confirmed by an administrator, all titles assigned to that plan unlock automatically.
          </p>
        </div>

        {user && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs dark:border-zinc-800 dark:bg-[#13131c]">
            <ShieldCheck
              className={`h-4 w-4 ${
                user.plan === 'premium' && !isExpired ? 'text-emerald-500' : 'text-zinc-400'
              }`}
            />
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                {user.plan === 'premium' && user.subscriptionPlanName
                  ? isExpired
                    ? `${user.subscriptionPlanName} (Expired)`
                    : `Active: ${user.subscriptionPlanName}`
                  : user.plan === 'premium'
                  ? 'Active: Premium Membership'
                  : 'Current Tier: Free'}
              </p>
              {user.planExpiresAt && (
                <p className="font-mono-tabular text-[11px] text-zinc-500 dark:text-zinc-400">
                  {isExpired ? 'Expired' : 'Renews'} {user.planExpiresAt.slice(0, 10)}
                </p>
              )}
            </div>
            {user.plan === 'premium' && (
              <button
                type="button"
                disabled={canceling}
                onClick={() => setCancelOpen(true)}
                className="ml-2 whitespace-nowrap rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {canceling ? 'Canceling...' : 'Cancel Plan'}
              </button>
            )}
          </div>
        )}
      </div>

      {requestBanner && (
        <div
          role="status"
          className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300"
        >
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0" />
            {requestBanner}
          </span>
          <button
            type="button"
            onClick={() => setRequestBanner(null)}
            className="text-xs underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {activePlans.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-[#13131c]">
          <Crown className="mx-auto h-10 w-10 text-zinc-400" />
          <h2 className="mt-3 font-display text-lg font-semibold">No monthly plans published yet</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Administrators can create custom monthly subscription plans inside the Admin Console under Subscriptions.
          </p>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {activePlans.map((plan) => {
            const isCurrent = currentPlanId === plan.id && !isExpired;
            const hasPending = pendingPlanIds.has(plan.id);
            const isHighlighted = highlightedPlanId === plan.id;
            const assignedMovies = movies.filter((m) => m.requiredPlanId === plan.id);

            return (
              <article
                key={plan.id}
                className={`flex flex-col justify-between rounded-2xl border bg-white p-6 transition-colors dark:bg-[#13131c] ${
                  isHighlighted || isCurrent
                    ? 'border-[var(--kv-accent,#e50914)] shadow-lg'
                    : 'border-zinc-200 dark:border-zinc-800'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: plan.badgeColor || '#e50914' }}
                      >
                        <Crown className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="font-display text-lg font-bold text-zinc-950 dark:text-white">
                          {plan.name}
                        </h2>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Billed monthly
                        </p>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="whitespace-nowrap text-xs font-semibold text-emerald-500">
                        Active
                      </span>
                    )}
                  </div>

                  <div className="mt-5 flex items-baseline gap-1.5 border-b border-zinc-200 pb-5 dark:border-zinc-800">
                    <span className="font-display text-3xl font-bold tracking-tight text-zinc-950 dark:text-white tabular-nums">
                      {formatMonthlyPrice(plan.pricePerMonth, plan.currency).replace('/mo', '')}
                    </span>
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      / month
                    </span>
                  </div>

                  {plan.description && (
                    <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                      {plan.description}
                    </p>
                  )}

                  {plan.features.length > 0 && (
                    <ul className="mt-4 space-y-2.5 text-xs text-zinc-700 dark:text-zinc-300">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Titles unlocked by this plan */}
                  <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      <Film className="h-3.5 w-3.5" />
                      <span>Included Titles ({assignedMovies.length})</span>
                    </p>
                    {assignedMovies.length === 0 ? (
                      <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                        No videos assigned to this tier yet.
                      </p>
                    ) : (
                      <div className="mt-2.5 space-y-1.5">
                        {assignedMovies.slice(0, 4).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => onSelectMovie(m)}
                            className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
                          >
                            <img
                              src={m.posterUrl}
                              alt={m.title}
                              referrerPolicy="no-referrer"
                              className="h-9 w-6 shrink-0 rounded object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                {m.title}
                              </p>
                              <p className="capitalize text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                                {m.type} · {m.releaseYear}
                              </p>
                            </div>
                          </button>
                        ))}
                        {assignedMovies.length > 4 && (
                          <p className="px-1.5 text-[11px] text-zinc-500">
                            +{assignedMovies.length - 4} more titles
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-2">
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled
                      className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                    >
                      <Check className="h-4 w-4" />
                      Active Monthly Plan
                    </button>
                  ) : hasPending ? (
                    <button
                      type="button"
                      disabled
                      className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
                    >
                      <Clock className="h-4 w-4" />
                      Waiting for Confirmation
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleChoosePlan(plan)}
                      className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      {!user && <Lock className="h-3.5 w-3.5" />}
                      {!user
                        ? `Sign In & Subscribe (${formatMonthlyPrice(plan.pricePerMonth, plan.currency)})`
                        : user.plan === 'premium'
                        ? `Request Switch to ${plan.name} (${formatMonthlyPrice(plan.pricePerMonth, plan.currency)})`
                        : `Subscribe Monthly (${formatMonthlyPrice(plan.pricePerMonth, plan.currency)})`}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Signed-in user's own order history */}
      {user && (
        <section className="mt-12 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-[#13131c]">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[var(--kv-accent,#e50914)]" />
              <h2 className="font-display text-base font-semibold text-zinc-950 dark:text-white">
                Your Orders &amp; Billing Requests
              </h2>
            </div>
            <span className="font-mono-tabular text-xs text-zinc-500">
              {orders.length} {orders.length === 1 ? 'order' : 'orders'}
            </span>
          </div>

          {orders.length === 0 ? (
            <p className="pt-4 text-xs text-zinc-500 dark:text-zinc-400">
              You have not submitted any subscription requests yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Method</th>
                    <th className="py-2 pr-4">Reference</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 text-right">Requested</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {orders.map((ord) => (
                    <tr key={ord.id}>
                      <td className="py-2.5 pr-4 font-semibold text-zinc-900 dark:text-zinc-100">
                        {ord.planName}
                      </td>
                      <td className="font-mono-tabular py-2.5 pr-4">
                        {formatCurrencyAmount(ord.amount, ord.currency)}
                      </td>
                      <td className="py-2.5 pr-4 uppercase text-zinc-500">
                        {ord.paymentMethod}
                      </td>
                      <td className="font-mono py-2.5 pr-4 text-zinc-500">
                        {ord.reference || '—'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            ORDER_STATUS_STYLES[ord.paymentStatus]
                          }`}
                        >
                          {ord.paymentStatus}
                        </span>
                      </td>
                      <td className="font-mono-tabular py-2.5 text-right text-zinc-500">
                        {formatRelativeTime(ord.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Confirm Subscription Request Modal */}
      <Modal
        open={Boolean(confirmPlan)}
        onClose={() => setConfirmPlan(null)}
        title={`Confirm ${confirmPlan?.name ?? 'Plan'} Request`}
        maxWidthClass="max-w-md"
      >
        {confirmPlan && (
          <form onSubmit={handleConfirmRequest} className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Selected Monthly Plan</p>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-display text-base font-bold">{confirmPlan.name}</span>
                <span className="font-mono-tabular text-base font-bold text-[var(--kv-accent,#e50914)]">
                  {formatCurrencyAmount(confirmPlan.pricePerMonth, confirmPlan.currency)}/mo
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Your order will be created in <strong>pending</strong> status and unlocked as soon
                as an administrator confirms your payment.
              </p>
            </div>

            <div>
              <label htmlFor="sub-method" className="mb-1 block text-xs font-medium text-zinc-500">
                Payment Method
              </label>
              <select
                id="sub-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as OrderPaymentMethod)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="manual">Manual / Bank Transfer</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="sub-ref" className="mb-1 block text-xs font-medium text-zinc-500">
                Payment Reference / UTR (optional)
              </label>
              <input
                id="sub-ref"
                type="text"
                maxLength={100}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. UTR-88392019"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmPlan(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Order Request'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel Subscription"
        message="Are you sure you want to cancel your active monthly plan and switch back to the Free tier?"
        confirmLabel="Switch to Free"
        danger
        loading={canceling}
        onCancel={() => setCancelOpen(false)}
        onConfirm={handleConfirmCancel}
      />
    </div>
  );
}
