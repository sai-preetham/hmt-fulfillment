import assert from 'node:assert/strict';
import test from 'node:test';
import { syncShipmentTrackingToAmazon } from '../src/amazonShipmentSync.js';

test('syncs Amazon shipment confirmation in mock/demo mode', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    const order = {
      id: 'order-db-id',
      external_order_id: 'AMZ-1234',
      order_number: 'AMZ-1234',
      raw_order: {
        items: [{ OrderItemId: 'item-1', QuantityOrdered: 1 }]
      }
    };
    const shipment = { waybill: 'DLV456', status: 'booked', courier_code: 'delhivery' };
    const config = {
      amazon: {
        clientId: '', // Trigger mock mode
        clientSecret: '',
        refreshToken: '',
        marketplaceId: 'A21TJRUUN4KGV'
      }
    };

    await syncShipmentTrackingToAmazon(order, shipment, config);

    const orderPatches = requests.filter(request => request.url.includes('/rest/v1/orders') && request.method === 'PATCH');
    assert.equal(orderPatches[0].body.wix_fulfillment_status, 'pending-fulfillment');
    assert.equal(orderPatches[1].body.wix_fulfillment_status, 'fulfilled');
    assert.equal(orderPatches[1].body.wix_fulfillment_id, 'MOCK-AMZ-FULFILLMENT-ID');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('submits shipment confirmation to real Amazon API when credentials exist', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    let body = null;
    if (options.body) {
      if (options.headers?.['Content-Type']?.includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(new URLSearchParams(options.body).entries());
      } else {
        body = JSON.parse(options.body);
      }
    }
    requests.push({ url: urlStr, method: options.method || 'GET', body });

    if (urlStr.includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (urlStr.includes('/auth/o2/token')) {
      return jsonResponse({ access_token: 'fake-lwa-token' });
    }
    if (urlStr.includes('/orders/v0/orders/AMZ-1234/shipmentConfirmation')) {
      return jsonResponse({ success: true });
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    const order = {
      id: 'order-db-id',
      external_order_id: 'AMZ-1234',
      order_number: 'AMZ-1234',
      raw_order: {
        items: [{ OrderItemId: 'item-1', QuantityOrdered: 1 }]
      }
    };
    const shipment = { waybill: 'DLV456', status: 'booked', courier_code: 'delhivery' };
    const config = {
      amazon: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        marketplaceId: 'A21TJRUUN4KGV'
      }
    };

    await syncShipmentTrackingToAmazon(order, shipment, config);

    const tokenReq = requests.find(r => r.url.includes('/auth/o2/token'));
    const confirmReq = requests.find(r => r.url.includes('/shipmentConfirmation'));
    const orderPatches = requests.filter(request => request.url.includes('/rest/v1/orders') && request.method === 'PATCH');

    assert.equal(tokenReq.body.client_id, 'client-id');
    assert.equal(confirmReq.body.marketplaceId, 'A21TJRUUN4KGV');
    assert.equal(confirmReq.body.packageDetail.trackingNumber, 'DLV456');
    assert.equal(orderPatches[0].body.wix_fulfillment_status, 'pending-fulfillment');
    assert.equal(orderPatches[1].body.wix_fulfillment_status, 'fulfilled');
    assert.ok(orderPatches[1].body.wix_fulfillment_id.startsWith('AMZ-FULFILLMENT-'));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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
