import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchWooCommerceOrders,
  nextWooWatermarkFromOrders,
  resolveWooModifiedAfterWatermark,
  wooBasicAuthHeader
} from '../src/woocommerce.js';
import { runWooOrderSync } from '../lib/crm/woo-sync.js';

test('wooBasicAuthHeader encodes consumer key/secret as Basic auth', () => {
  const header = wooBasicAuthHeader('ck_test', 'cs_test');
  assert.equal(header.startsWith('Basic '), true);
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  assert.equal(decoded, 'ck_test:cs_test');
});

test('fetchWooCommerceOrders pages with modified_after and Basic auth', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers });
    const page = Number(new URL(url).searchParams.get('page') || 1);
    const orders =
      page === 1
        ? [
            { id: 101, date_modified_gmt: '2026-09-19T10:00:00', status: 'processing', total: '100.00' },
            { id: 102, date_modified_gmt: '2026-09-19T11:00:00', status: 'processing', total: '200.00' }
          ]
        : [{ id: 103, date_modified_gmt: '2026-09-19T12:00:00', status: 'completed', total: '50.00' }];
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          if (key === 'x-wp-totalpages') return '2';
          if (key === 'x-wp-total') return '3';
          return null;
        }
      },
      json: async () => orders
    };
  };

  const config = {
    woocommerce: {
      baseUrl: 'https://wp-staging.holdmythrottle.com',
      consumerKey: 'ck_test',
      consumerSecret: 'cs_test',
      orderSync: { pageSize: 2 }
    }
  };

  const page1 = await fetchWooCommerceOrders(config, {
    page: 1,
    perPage: 2,
    modifiedAfter: '2026-09-19T00:00:00.000Z',
    fetchImpl
  });
  assert.equal(page1.orders.length, 2);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.totalPages, 2);

  const page2 = await fetchWooCommerceOrders(config, {
    page: 2,
    perPage: 2,
    modifiedAfter: '2026-09-19T00:00:00.000Z',
    fetchImpl
  });
  assert.equal(page2.orders.length, 1);
  assert.equal(page2.hasMore, false);

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/wp-json\/wc\/v3\/orders/);
  assert.match(calls[0].url, /modified_after=/);
  assert.match(calls[0].url, /orderby=modified/);
  assert.equal(calls[0].headers.Authorization, wooBasicAuthHeader('ck_test', 'cs_test'));
});

test('watermark helpers bound cold runs and advance from orders', () => {
  const config = { woocommerce: { orderSync: { intervalMs: 15 * 60_000 } } };
  const cold = resolveWooModifiedAfterWatermark({}, config, { force: false });
  assert.ok(typeof cold === 'string' && cold.length > 10);

  const forced = resolveWooModifiedAfterWatermark(
    { watermarkModifiedAfter: '2026-01-01T00:00:00.000Z' },
    config,
    { force: true }
  );
  assert.equal(forced, null);

  const kept = resolveWooModifiedAfterWatermark(
    { watermarkModifiedAfter: '2026-09-18T00:00:00.000Z' },
    config
  );
  assert.equal(kept, '2026-09-18T00:00:00.000Z');

  const next = nextWooWatermarkFromOrders(
    [{ date_modified_gmt: '2026-09-19T12:00:00' }, { date_modified_gmt: '2026-09-19T10:00:00' }],
    '2026-09-19T09:00:00.000Z'
  );
  assert.equal(next, '2026-09-19T11:59:59.000Z');
});

test('runWooOrderSync fails closed when disabled', async () => {
  // Force false — delete is unreliable when systemd/EnvironmentFile injects the var
  // (as on saipi deploys that symlink production .env before npm test).
  process.env.WOO_ORDER_SYNC_ENABLED = 'false';
  process.env.WOO_BASE_URL = 'https://wp-staging.holdmythrottle.com';
  process.env.WOO_CONSUMER_KEY = 'ck_test';
  process.env.WOO_CONSUMER_SECRET = 'cs_test';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  const result = await runWooOrderSync({ reason: 'unit-disabled', force: true });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
});

test('runWooOrderSync pages through Woo and counts upserts with mocked fetch/store', async () => {
  const upsertCalls = [];

  process.env.WOO_ORDER_SYNC_ENABLED = 'true';
  process.env.WOO_BASE_URL = 'https://wp-staging.holdmythrottle.com';
  process.env.WOO_CONSUMER_KEY = 'ck_test';
  process.env.WOO_CONSUMER_SECRET = 'cs_test';
  process.env.WOO_ORDER_SYNC_PAGE_SIZE = '2';
  process.env.WOO_ORDER_SYNC_MAX_PAGES = '2';
  process.env.WOO_AUTO_SYNC_MIN_INTERVAL_SECONDS = '1';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  const fetchImpl = async url => {
    const page = Number(new URL(String(url)).searchParams.get('page') || 1);
    const orders =
      page === 1
        ? [sampleWoo(201, '2026-09-19T08:00:00'), sampleWoo(202, '2026-09-19T09:00:00')]
        : [sampleWoo(203, '2026-09-19T10:00:00')];
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          if (key === 'x-wp-totalpages') return '2';
          if (key === 'x-wp-total') return '3';
          return null;
        }
      },
      json: async () => orders
    };
  };

  try {
    const result = await runWooOrderSync({
      reason: 'unit-page',
      force: true,
      deps: {
        isSupabaseConfigured: () => true,
        fetchWooCommerceOrders: (config, options) =>
          fetchWooCommerceOrders(config, { ...options, fetchImpl }),
        upsertWooCommerceOrders: async orders => {
          upsertCalls.push(orders.map(o => o.id));
          return orders.map((order, index) => ({
            order: { id: `uuid-${order.id}`, woo_order_id: String(order.id) },
            created: index === 0,
            updated: index !== 0
          }));
        }
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.pulled, 3);
    assert.equal(result.persisted, 3);
    assert.equal(result.pages, 2);
    assert.deepEqual(upsertCalls.flat(), [201, 202, 203]);
  } finally {
    delete process.env.WOO_ORDER_SYNC_ENABLED;
    delete process.env.WOO_BASE_URL;
    delete process.env.WOO_CONSUMER_KEY;
    delete process.env.WOO_CONSUMER_SECRET;
  }
});

function sampleWoo(id, modifiedGmt) {
  return {
    id,
    number: String(id),
    status: 'processing',
    currency: 'INR',
    date_created_gmt: modifiedGmt,
    date_modified_gmt: modifiedGmt,
    total: '1499.00',
    billing: {
      first_name: 'Test',
      last_name: 'Buyer',
      email: 'test@example.com',
      phone: '9999999999',
      address_1: '1 Main',
      city: 'Bengaluru',
      state: 'KA',
      postcode: '560001',
      country: 'IN'
    },
    shipping: {
      first_name: 'Test',
      last_name: 'Buyer',
      address_1: '1 Main',
      city: 'Bengaluru',
      state: 'KA',
      postcode: '560001',
      country: 'IN'
    },
    line_items: [{ id: 1, name: 'Kit', quantity: 1, sku: 'HMT-TEST', price: 1499, total: '1499.00' }]
  };
}
