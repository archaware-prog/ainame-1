import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import {
  CheckCircle2,
  Download,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
  XCircle,
} from 'lucide-react';
import {
  createManualPaidOrderBatch,
  exportOrdersCsvAndLog,
  fetchOrdersPage,
  fetchUsersPage,
  markOrderFailedBatch,
  markOrderPaidBatch,
  refundOrderBatch,
  retryFailedOrderBatch,
} from '../../lib/ordersFirebase';
import type {
  OrderItem,
  OrderPaymentMethod,
  OrderPaymentStatus,
  SubscriptionPlan,
  UserProfile,
} from '../../types/streaming';
import { formatRelativeTime } from '../../utils/catalog';
import { formatCurrencyAmount } from '../../utils/orders';
import { ConfirmDialog, Modal } from '../ui/Modal';

interface OrdersManagerProps {
  adminUid: string;
  plans: SubscriptionPlan[];
  onMutateSuccess: () => void;
  onNotify: (message: string, type: 'success' | 'error' | 'info') => void;
}

const STATUS_BADGE: Record<OrderPaymentStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  paid: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  refunded: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

export function OrdersManager({
  adminUid,
  plans,
  onMutateSuccess,
  onNotify,
}: OrdersManagerProps) {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderPaymentStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Mark Paid modal
  const [payingOrder, setPayingOrder] = useState<OrderItem | null>(null);
  const [payMethod, setPayMethod] = useState<OrderPaymentMethod>('upi');
  const [payReference, setPayReference] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Mark Failed modal
  const [failingOrder, setFailingOrder] = useState<OrderItem | null>(null);
  const [failReference, setFailReference] = useState('');

  // Refund modal / confirm
  const [refundingOrder, setRefundingOrder] = useState<OrderItem | null>(null);
  const [refundReference, setRefundReference] = useState('');

  // Reopen Failed confirm
  const [retryingOrder, setRetryingOrder] = useState<OrderItem | null>(null);

  // Create Manual Paid Order modal
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [memberOptions, setMemberOptions] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [manualMethod, setManualMethod] = useState<OrderPaymentMethod>('manual');
  const [manualReference, setManualReference] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchOrdersPage({ statusFilter, cursor: null, pageSize: 25 });
      setOrders(page.items);
      setCursor(page.lastDoc);
      setHasMore(page.hasMore);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load orders.', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, onNotify]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchOrdersPage({ statusFilter, cursor, pageSize: 25 });
      setOrders((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...page.items.filter((x) => !seen.has(x.id))];
      });
      setCursor(page.lastDoc);
      setHasMore(page.hasMore);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not load more orders.', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const { csv, count } = await exportOrdersCsvAndLog({ statusFilter, adminUid });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ainame-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify(`Exported ${count} orders to CSV (audit logged)`, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'CSV export failed.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const openManualOrderModal = async () => {
    setManualModalOpen(true);
    setManualMethod('manual');
    setManualReference('');
    const activePlan = plans.find((p) => p.isActive) ?? plans[0];
    setSelectedPlanId(activePlan?.id ?? '');
    if (memberOptions.length === 0) {
      setLoadingMembers(true);
      try {
        const res = await fetchUsersPage({ roleFilter: 'all', planFilter: 'all', pageSize: 50 });
        setMemberOptions(res.items);
        if (res.items[0]) setSelectedUserId(res.items[0].uid);
      } catch {
        onNotify('Could not load member list.', 'error');
      } finally {
        setLoadingMembers(false);
      }
    }
  };

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.userName.toLowerCase().includes(q) ||
        o.userEmail.toLowerCase().includes(q) ||
        o.planName.toLowerCase().includes(q) ||
        (o.reference ?? '').toLowerCase().includes(q)
    );
  }, [orders, search]);

  const activePlans = plans.filter((p) => p.isActive);
  const manualPlan = plans.find((p) => p.id === selectedPlanId) ?? activePlans[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order ID, user, reference..."
              className="rounded-lg border border-zinc-300 bg-white py-2 pl-8 pr-3 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
            />
          </div>
          <select
            aria-label="Filter orders by payment status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OrderPaymentStatus | 'all')}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-[#13131c]"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </select>
          <button
            type="button"
            onClick={() => void loadFirstPage()}
            aria-label="Refresh orders"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3.5 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={() => void openManualOrderModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Manual Order
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#13131c]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="p-3">Order / Member</th>
              <th className="p-3">Plan</th>
              <th className="p-3">Amount</th>
              <th className="p-3">Method</th>
              <th className="p-3">Reference</th>
              <th className="p-3">Status</th>
              <th className="p-3">Created</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={8} className="p-4">
                    <div className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  </td>
                </tr>
              ))
            ) : filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-zinc-500">
                  No orders found for the current filter.
                </td>
              </tr>
            ) : (
              filteredOrders.map((ord) => (
                <tr key={ord.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="p-3">
                    <p className="font-semibold">{ord.userName}</p>
                    <p className="text-[11px] text-zinc-500">{ord.userEmail}</p>
                    <p className="font-mono text-[10px] text-zinc-400">{ord.id}</p>
                  </td>
                  <td className="p-3 font-medium">{ord.planName}</td>
                  <td className="font-mono-tabular p-3 font-semibold">
                    {formatCurrencyAmount(ord.amount, ord.currency)}
                  </td>
                  <td className="p-3 uppercase text-zinc-500">{ord.paymentMethod}</td>
                  <td className="font-mono p-3 text-zinc-500">{ord.reference || '—'}</td>
                  <td className="p-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        STATUS_BADGE[ord.paymentStatus]
                      }`}
                    >
                      {ord.paymentStatus}
                    </span>
                  </td>
                  <td className="font-mono-tabular p-3 text-zinc-500">
                    {formatRelativeTime(ord.createdAt)}
                  </td>
                  <td className="p-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {ord.paymentStatus === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setPayingOrder(ord);
                              setPayMethod(ord.paymentMethod || 'upi');
                              setPayReference(ord.reference ?? '');
                            }}
                            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Mark Paid
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFailingOrder(ord);
                              setFailReference(ord.reference ?? '');
                            }}
                            className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10"
                          >
                            <XCircle className="h-3 w-3" />
                            Fail
                          </button>
                        </>
                      )}
                      {ord.paymentStatus === 'failed' && (
                        <button
                          type="button"
                          onClick={() => setRetryingOrder(ord)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-[11px] font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reopen
                        </button>
                      )}
                      {ord.paymentStatus === 'paid' && (
                        <button
                          type="button"
                          onClick={() => {
                            setRefundingOrder(ord);
                            setRefundReference(ord.reference ?? '');
                          }}
                          className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-500 hover:bg-amber-500/10"
                        >
                          <Undo2 className="h-3 w-3" />
                          Refund
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void handleLoadMore()}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {loadingMore ? 'Loading more...' : 'Load Next 25 Orders'}
          </button>
        </div>
      )}

      {/* Mark Paid Modal */}
      <Modal
        open={Boolean(payingOrder)}
        onClose={() => setPayingOrder(null)}
        title="Confirm Payment & Activate Plan"
        maxWidthClass="max-w-md"
      >
        {payingOrder && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setActionBusy(true);
              try {
                const updated = await markOrderPaidBatch({
                  order: payingOrder,
                  adminUid,
                  paymentMethod: payMethod,
                  reference: payReference,
                });
                setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                setPayingOrder(null);
                onMutateSuccess();
                onNotify(`Marked order ${updated.id} paid & upgraded ${updated.userName}`, 'success');
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Could not confirm order.', 'error');
              } finally {
                setActionBusy(false);
              }
            }}
            className="space-y-4"
          >
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
              <p className="font-semibold">
                {payingOrder.userName} ({payingOrder.userEmail})
              </p>
              <p className="mt-1 text-zinc-500">
                {payingOrder.planName} ·{' '}
                <strong className="text-zinc-900 dark:text-zinc-100">
                  {formatCurrencyAmount(payingOrder.amount, payingOrder.currency)}
                </strong>
              </p>
            </div>
            <div>
              <label htmlFor="pay-method" className="mb-1 block text-xs text-zinc-500">
                Payment Method
              </label>
              <select
                id="pay-method"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as OrderPaymentMethod)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="upi">UPI</option>
                <option value="manual">Manual / Bank Transfer</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="pay-ref" className="mb-1 block text-xs text-zinc-500">
                Transaction / UTR Reference (optional)
              </label>
              <input
                id="pay-ref"
                type="text"
                maxLength={100}
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="e.g. UTR-44551290"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayingOrder(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {actionBusy ? 'Confirming...' : 'Confirm & Unlock Premium'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Mark Failed Modal */}
      <Modal
        open={Boolean(failingOrder)}
        onClose={() => setFailingOrder(null)}
        title="Mark Order Failed"
        maxWidthClass="max-w-md"
      >
        {failingOrder && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setActionBusy(true);
              try {
                const updated = await markOrderFailedBatch({
                  order: failingOrder,
                  adminUid,
                  reference: failReference,
                });
                setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                setFailingOrder(null);
                onMutateSuccess();
                onNotify(`Marked order ${updated.id} as failed`, 'info');
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Failed to update order.', 'error');
              } finally {
                setActionBusy(false);
              }
            }}
            className="space-y-4"
          >
            <p className="text-xs text-zinc-500">
              Mark order <strong>{failingOrder.id}</strong> for {failingOrder.userName} as{' '}
              <strong>failed</strong>.
            </p>
            <div>
              <label htmlFor="fail-ref" className="mb-1 block text-xs text-zinc-500">
                Failure Note / Reference (optional)
              </label>
              <input
                id="fail-ref"
                type="text"
                maxLength={100}
                value={failReference}
                onChange={(e) => setFailReference(e.target.value)}
                placeholder="e.g. Payment verification mismatch"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFailingOrder(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {actionBusy ? 'Updating...' : 'Mark Failed'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Refund Modal */}
      <Modal
        open={Boolean(refundingOrder)}
        onClose={() => setRefundingOrder(null)}
        title="Refund Paid Order"
        maxWidthClass="max-w-md"
      >
        {refundingOrder && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setActionBusy(true);
              try {
                const updated = await refundOrderBatch({
                  order: refundingOrder,
                  adminUid,
                  reference: refundReference,
                });
                setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                setRefundingOrder(null);
                onMutateSuccess();
                onNotify(`Refunded order ${updated.id} & reverted user to Free tier`, 'info');
              } catch (err) {
                onNotify(err instanceof Error ? err.message : 'Refund failed.', 'error');
              } finally {
                setActionBusy(false);
              }
            }}
            className="space-y-4"
          >
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              Refunding <strong>{formatCurrencyAmount(refundingOrder.amount, refundingOrder.currency)}</strong>{' '}
              for <strong>{refundingOrder.userName}</strong> will mark the order as refunded and
              revert their account back to the Free tier atomically.
            </p>
            <div>
              <label htmlFor="refund-ref" className="mb-1 block text-xs text-zinc-500">
                Refund Reference (optional)
              </label>
              <input
                id="refund-ref"
                type="text"
                maxLength={100}
                value={refundReference}
                onChange={(e) => setRefundReference(e.target.value)}
                placeholder="e.g. REFUND-2026-01"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefundingOrder(null)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {actionBusy ? 'Refunding...' : 'Confirm Refund'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reopen Failed Order Confirm */}
      <ConfirmDialog
        open={Boolean(retryingOrder)}
        title="Reopen Failed Order"
        message={`Move order ${retryingOrder?.id} back to pending so it can be confirmed later?`}
        confirmLabel="Move to Pending"
        loading={actionBusy}
        onCancel={() => setRetryingOrder(null)}
        onConfirm={async () => {
          if (!retryingOrder) return;
          setActionBusy(true);
          try {
            const updated = await retryFailedOrderBatch({ order: retryingOrder, adminUid });
            setOrders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            setRetryingOrder(null);
            onMutateSuccess();
            onNotify('Order moved back to pending', 'info');
          } catch (err) {
            onNotify(err instanceof Error ? err.message : 'Failed to reopen order.', 'error');
          } finally {
            setActionBusy(false);
          }
        }}
      />

      {/* Create Manual Paid Order Modal */}
      <Modal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Create Manual Paid Order"
        maxWidthClass="max-w-md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const targetUser = memberOptions.find((u) => u.uid === selectedUserId);
            if (!targetUser || !manualPlan) {
              onNotify('Select both a member and an active plan.', 'error');
              return;
            }
            setActionBusy(true);
            try {
              const created = await createManualPaidOrderBatch({
                user: targetUser,
                plan: manualPlan,
                paymentMethod: manualMethod,
                reference: manualReference,
                adminUid,
              });
              setOrders((prev) => [created, ...prev]);
              setManualModalOpen(false);
              onMutateSuccess();
              onNotify(
                `Recorded manual paid order for ${targetUser.displayName} & activated ${manualPlan.name}`,
                'success'
              );
            } catch (err) {
              onNotify(err instanceof Error ? err.message : 'Could not create order.', 'error');
            } finally {
              setActionBusy(false);
            }
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="man-user" className="mb-1 block text-xs text-zinc-500">
              Member *
            </label>
            <select
              id="man-user"
              required
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {loadingMembers ? (
                <option value="">Loading members...</option>
              ) : memberOptions.length === 0 ? (
                <option value="">No users found in Firestore</option>
              ) : (
                memberOptions.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName} ({u.email})
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="man-plan" className="mb-1 block text-xs text-zinc-500">
              Monthly Plan *
            </label>
            <select
              id="man-plan"
              required
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatCurrencyAmount(p.pricePerMonth, p.currency)}/mo
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="man-method" className="mb-1 block text-xs text-zinc-500">
              Payment Method
            </label>
            <select
              id="man-method"
              value={manualMethod}
              onChange={(e) => setManualMethod(e.target.value as OrderPaymentMethod)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="manual">Manual / Cash / Bank</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="man-ref" className="mb-1 block text-xs text-zinc-500">
              Reference / Receipt ID (optional)
            </label>
            <input
              id="man-ref"
              type="text"
              maxLength={100}
              value={manualReference}
              onChange={(e) => setManualReference(e.target.value)}
              placeholder="e.g. INV-2026-104"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-xs dark:border-zinc-700"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setManualModalOpen(false)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold dark:border-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionBusy || memberOptions.length === 0 || !manualPlan}
              className="rounded-lg bg-[var(--kv-accent,#e50914)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {actionBusy ? 'Saving...' : 'Create Paid Order'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
