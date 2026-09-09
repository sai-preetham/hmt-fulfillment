import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

// Render the actual route with controlled data and synchronous boundary doubles.
// No production database, session, or shipment side effects are involved.
async function renderHomepage({ orders = [], tasks = [] } = {}) {
  const summary = {
    newOrders: 7, ordersToPack: 6, shipmentsToBook: 5, pickupPending: 4,
    deliveredToday: 3, installationDue: 2, feedbackDue: 1, openIssues: 0,
    avgOrderToShipmentHours: 18, avgShipmentToDeliveryDays: 3.2,
    installationCompletionRate: 80, feedbackCompletionRate: 70
  };
  const mocks = {
    'next/link': { default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children), __esModule: true },
    '@/components/app-shell': { AppShell: ({ children }) => React.createElement('main', null, children) },
    '@/components/order-table': { OrderTable: ({ orders }) => React.createElement('div', null, orders.map(order => React.createElement('span', { key: order.id }, order.order_number))) },
    '@/components/status-pill': { StatusPill: ({ value }) => React.createElement('span', null, value) },
    '@/lib/crm/data': {
      getDashboardSummary: async () => summary,
      listOrders: async options => { assert.deepEqual(JSON.parse(JSON.stringify(options)), { limit: 8 }); return orders; },
      listTasks: async () => tasks
    }
  };
  const { code } = transformSync(readFileSync(new URL('../app/page.jsx', import.meta.url), 'utf8'), {
    filename: 'page.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
    module: { type: 'commonjs' }
  });
  const exports = {};
  runInNewContext(code, { exports, require: name => mocks[name] || require(name) });
  return renderToStaticMarkup(await exports.default());
}

test('home route renders the operations dashboard and operational links', async () => {
  const html = await renderHomepage({
    orders: [{ id: 'order-1', order_number: 'TEST-10587' }],
    tasks: [{ id: 'task-1', title: 'Arrange pickup', order_number: 'TEST-10587', priority: 'high', status: 'pending' }]
  });
  for (const text of ['Operations command center', 'Recent orders', 'Urgent tasks', 'New orders', 'Orders to pack', 'Shipments to book', 'Pickup pending', 'Delivered today', 'Installation follow-ups due', 'Feedback calls due', 'Open issues', 'TEST-10587', 'Arrange pickup', 'Unassigned']) assert.ok(html.includes(text), `Missing ${text}`);
  assert.match(html, /New orders<\/span><strong>7<\/strong>/);
  for (const path of ['/orders', '/shipments', '/tasks']) assert.ok(html.includes(`href="${path}"`));
  assert.match(html, /action="\/orders"/);
  assert.match(html, /name="q"/);
  assert.doesNotMatch(html, /mongersmint|Book my demo/i);
});

test('home route renders with empty order and task queues', async () => {
  const html = await renderHomepage();
  assert.match(html, /Operations command center/);
  assert.match(html, /Recent orders/);
  assert.match(html, /Urgent tasks/);
  assert.doesNotMatch(html, /mongersmint|undefined|NaN/i);
});
