import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLocalStartOfTodayIso,
  computeSevenDaysAgoIso,
  exportOrdersToCsv,
  formatCurrencyAmount,
  hasMaxTwoDecimals,
  isValidOrderTransition,
  roundCurrency,
  validateBlogPostDraft,
  validateOrderDraft,
} from './orders';
import type { OrderItem } from '../types/streaming';

test('roundCurrency and hasMaxTwoDecimals enforce currency precision', () => {
  assert.equal(roundCurrency(9.994), 9.99);
  assert.equal(roundCurrency(19.996), 20);
  assert.equal(hasMaxTwoDecimals(9.99), true);
  assert.equal(hasMaxTwoDecimals(0), true);
  assert.equal(hasMaxTwoDecimals(9.995), false);
  assert.equal(hasMaxTwoDecimals(-1), false);
});

test('isValidOrderTransition enforces strict payment state machine', () => {
  assert.equal(isValidOrderTransition('pending', 'paid'), true);
  assert.equal(isValidOrderTransition('pending', 'failed'), true);
  assert.equal(isValidOrderTransition('failed', 'pending'), true);
  assert.equal(isValidOrderTransition('paid', 'refunded'), true);

  assert.equal(isValidOrderTransition('pending', 'refunded'), false);
  assert.equal(isValidOrderTransition('paid', 'pending'), false);
  assert.equal(isValidOrderTransition('paid', 'failed'), false);
  assert.equal(isValidOrderTransition('refunded', 'paid'), false);
  assert.equal(isValidOrderTransition('failed', 'paid'), false);
});

test('validateOrderDraft catches invalid decimals and long references', () => {
  const valid = validateOrderDraft({
    userId: 'u1',
    userEmail: 'u1@example.com',
    userName: 'Alice',
    planId: 'plan-plus',
    planName: 'Cinema Plus',
    amount: 9.99,
    currency: 'USD',
    paymentMethod: 'upi',
    reference: 'UTR123456',
  });
  assert.deepEqual(valid, {});

  const invalid = validateOrderDraft({
    userId: '',
    amount: 9.999,
    currency: '',
    paymentMethod: 'upi',
    reference: 'x'.repeat(101),
  });
  assert.ok(invalid.userId);
  assert.ok(invalid.amount);
  assert.ok(invalid.currency);
  assert.ok(invalid.reference);
});

test('exportOrdersToCsv formats headers and escapes quotes safely', () => {
  const orders: OrderItem[] = [
    {
      id: 'ord-1',
      userId: 'u1',
      userEmail: 'a@example.com',
      userName: 'Alice "Ace"',
      planId: 'plan-plus',
      planName: 'Cinema Plus',
      amount: 9.99,
      currency: 'USD',
      paymentStatus: 'paid',
      paymentMethod: 'upi',
      reference: 'UTR-99',
      createdAt: '2026-04-01T10:00:00.000Z',
      paidAt: '2026-04-01T10:05:00.000Z',
      updatedAt: '2026-04-01T10:05:00.000Z',
    },
  ];
  const csv = exportOrdersToCsv(orders);
  const lines = csv.split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Order ID,User ID,Name/);
  assert.match(lines[1], /"Alice ""Ace"""/);
  assert.match(lines[1], /"9\.99"/);
});

test('date helpers and currency formatting produce deterministic outputs', () => {
  const sample = new Date(2026, 3, 15, 14, 30, 0);
  const startToday = new Date(computeLocalStartOfTodayIso(sample));
  assert.equal(startToday.getFullYear(), 2026);
  assert.equal(startToday.getMonth(), 3);
  assert.equal(startToday.getDate(), 15);
  assert.equal(startToday.getHours(), 0);

  const sevenDays = Date.parse(computeSevenDaysAgoIso(sample));
  assert.equal(sample.getTime() - sevenDays, 7 * 86400_000);
  assert.equal(formatCurrencyAmount(9.99, 'USD'), '$9.99');
});

test('validateBlogPostDraft validates required fields and slug format', () => {
  const ok = validateBlogPostDraft({
    title: 'Spring Simulcast Lineup',
    slug: 'spring-simulcast-lineup',
    excerpt: 'New anime releases arriving this month.',
    contentHtml: '<p>Full announcement details.</p>',
  });
  assert.deepEqual(ok, {});

  const bad = validateBlogPostDraft({
    title: '',
    slug: 'Invalid Slug!',
    excerpt: '',
    contentHtml: '',
  });
  assert.ok(bad.title);
  assert.ok(bad.slug);
  assert.ok(bad.excerpt);
  assert.ok(bad.contentHtml);
});
