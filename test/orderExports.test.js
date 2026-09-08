import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyDemand, buildOrderRows, buildSourcingRows, countUnfulfilledOrders, formatDiscordDailyReport, previousCalendarDayBounds, summarizePreviousDayOrders } from '../lib/crm/order-exports.js';

const orders = [{ order_number: '1001', source_created_at: '2026-07-16T00:00:00.000Z', status: 'PAID', customers: { name: 'Asha', email: 'asha@example.com' }, order_items: [{ sku: 'HMT-RED', product_name: 'Throttle Red', quantity: 2, price: 1000 }] }];
test('builds an order-per-item sheet and sourcing roll-up', () => {
  assert.equal(buildOrderRows(orders)[1][0], '1001');
  assert.deepEqual(buildSourcingRows(orders)[1], ['HMT-RED', 'Throttle Red', 2, 1]);
});
test('uses the completed previous calendar day in India time', () => {
  const bounds = previousCalendarDayBounds(new Date('2026-07-16T12:00:00.000Z'), 'Asia/Kolkata');
  assert.equal(bounds.date, '2026-07-15');
  assert.equal(bounds.start, '2026-07-14T18:30:00.000Z');
  assert.equal(bounds.end, '2026-07-15T18:30:00.000Z');
});

test('groups the previous day item quantities for one demand column', () => {
  const bounds = { start: '2026-07-14T18:30:00.000Z', end: '2026-07-15T18:30:00.000Z' };
  const daily = buildDailyDemand([{ source_created_at: '2026-07-15T10:00:00.000Z', order_items: [{ sku: 'HMT-RED', product_name: 'Throttle Red', quantity: 2 }] }, { source_created_at: '2026-07-15T12:00:00.000Z', order_items: [{ sku: 'HMT-RED', product_name: 'Throttle Red', quantity: 1 }] }, { status: 'CANCELED', source_created_at: '2026-07-15T13:00:00.000Z', order_items: [{ sku: 'HMT-BLK', product_name: 'Throttle Black', quantity: 8 }] }], bounds);
  assert.deepEqual(daily, [{ sku: 'HMT-RED', product: 'Throttle Red', quantity: 3 }]);
});

test('formats the daily Discord scorecard from paid and international orders', () => {
  const summary = summarizePreviousDayOrders([{ payment_status: 'PAID', total_amount: 1999, shipping_address: { country: 'India' } }, { payment_status: 'APPROVED', total_amount: 100, shipping_address: { country: 'US' } }, { status: 'CANCELED', payment_status: 'PAID', total_amount: 999 }], 5);
  const message = formatDiscordDailyReport({ ...summary, unfulfilledCount: 7, bounds: { date: '2026-07-15' } });
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.internationalCount, 1);
  assert.match(message, /Order : 2\/5/);
  assert.match(message, /₹2,099/);
  assert.match(message, /Unfulfilled order : 7/);
  assert.equal(countUnfulfilledOrders([{ fulfillment_status: 'NOT_FULFILLED' }, { fulfillment_status: 'FULFILLED' }, { status: 'CANCELED' }]), 1);
});
