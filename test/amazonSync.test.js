import assert from 'node:assert/strict';
import test from 'node:test';
import { runAmazonOrderSync } from '../lib/crm/amazon-sync.js';

test('runs Amazon sync in mock/demo mode when credentials are missing', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });

    // Stub Supabase queries
    if (String(url).includes('/rest/v1/customers') && options.method === 'POST') {
      return jsonResponse({ id: 'cust-1', email: 'sneha@example.com' });
    }
    if (String(url).includes('/rest/v1/customers') && (options.method || 'GET') === 'GET') {
      return jsonResponse([]);
    }
    if (String(url).includes('/rest/v1/customer_addresses') && options.method === 'POST') {
      return jsonResponse({ id: 'addr-1' });
    }
    if (String(url).includes('/rest/v1/orders') && (options.method || 'GET') === 'GET') {
      return jsonResponse([]);
    }
    if (String(url).includes('/rest/v1/orders') && options.method === 'POST') {
      return jsonResponse({ id: 'order-1', external_order_id: 'AMZ-mock' });
    }
    if (String(url).includes('/rest/v1/order_source_versions') && options.method === 'POST') {
      return jsonResponse({ id: 'os-1' });
    }
    if (String(url).includes('/rest/v1/order_items') && options.method === 'POST') {
      return jsonResponse({ id: 'item-1' });
    }
    if (String(url).includes('/rest/v1/inventory_items') && options.method === 'POST') {
      return jsonResponse({ sku: 'HMT-390-ADV-KIT' });
    }
    if (String(url).includes('/rest/v1/payment_refs') && options.method === 'POST') {
      return jsonResponse({ id: 'pay-1' });
    }
    if (String(url).includes('/rest/v1/audit_log') && options.method === 'POST') {
      return jsonResponse({ id: 'audit-1' });
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  // Ensure LWA credentials are empty
  const oldClientId = process.env.AMAZON_SP_API_CLIENT_ID;
  const oldClientSecret = process.env.AMAZON_SP_API_CLIENT_SECRET;
  const oldRefreshToken = process.env.AMAZON_SP_API_REFRESH_TOKEN;
  delete process.env.AMAZON_SP_API_CLIENT_ID;
  delete process.env.AMAZON_SP_API_CLIENT_SECRET;
  delete process.env.AMAZON_SP_API_REFRESH_TOKEN;

  try {
    const result = await runAmazonOrderSync({ reason: 'manual', force: true });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'demo');
    assert.equal(result.pulled, 1);
    assert.equal(result.persisted, 1);

    const customerPost = requests.find(r => r.url.includes('/rest/v1/customers') && r.method === 'POST');
    const orderPost = requests.find(r => r.url.includes('/rest/v1/orders') && r.method === 'POST');
    assert.equal(customerPost.body.email, 'sneha@example.com');
    assert.ok(orderPost.body.external_order_id.startsWith('AMZ-406-'));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (oldClientId !== undefined) process.env.AMAZON_SP_API_CLIENT_ID = oldClientId;
    if (oldClientSecret !== undefined) process.env.AMAZON_SP_API_CLIENT_SECRET = oldClientSecret;
    if (oldRefreshToken !== undefined) process.env.AMAZON_SP_API_REFRESH_TOKEN = oldRefreshToken;
  }
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload
  };
}
