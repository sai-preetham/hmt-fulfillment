import assert from 'node:assert/strict';
import test from 'node:test';
import { syncBookedShipmentToWix } from '../src/booking.js';
import { fulfillManualShipmentInWix, markOrderPackedInWix, markShipmentPickedUpInWix, syncShipmentTrackingToWix } from '../src/wixShipmentSync.js';

test('keeps a generated AWB local and does not fulfill Wix before pickup', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/orders') && (options.method || 'GET') === 'GET') {
      return jsonResponse([{
        id: 'order-db-id',
        wix_order_id: 'wix-order-1',
        raw_order: { lineItems: [{ id: 'line-1', quantity: 1 }] }
      }]);
    }
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (String(url).includes('/create-fulfillment')) {
      return jsonResponse({ fulfillment: { id: 'fulfillment-1' } });
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await syncBookedShipmentToWix(
      {
        id: 'order-db-id',
        wix_order_id: 'wix-order-1',
        raw_order: { lineItems: [{ id: 'line-1', quantity: 1 }] }
      },
      { waybill: 'AWB123', status: 'booked', service_mode: 'Express' },
      config()
    );

    const orderPatches = requests.filter(request => request.url.includes('/rest/v1/orders') && request.method === 'PATCH');
    assert.equal(requests.some(request => request.url.includes('/create-fulfillment')), false);
    assert.equal(orderPatches[0].body.wix_fulfillment_status, 'awaiting-pickup');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('carrier pickup does not fulfill Wix without an operator action', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Automatic pickup must not make requests'); };
  try {
    assert.equal(await markShipmentPickedUpInWix({ order_id: 'order-1', waybill: 'AWB123', status: 'picked-up' }, config()), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('marks Wix fulfillment fulfilled when order is packed', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });

    if (String(url).includes('/rest/v1/orders') && (options.method || 'GET') === 'GET') {
      return jsonResponse([
        {
          id: 'order-db-id',
          wix_order_id: 'wix-order-1',
          wix_fulfillment_id: 'fulfillment-1',
          raw_order: { lineItems: [{ id: 'line-1', quantity: 1 }] }
        }
      ]);
    }
    if (String(url).includes('/rest/v1/shipments') && (options.method || 'GET') === 'GET') {
      return jsonResponse([
        {
          id: 'shipment-db-id',
          order_id: 'order-db-id',
          waybill: 'AWB123',
          status: 'booked',
          service_mode: 'Express'
        }
      ]);
    }
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (String(url).includes('/create-fulfillment')) {
      return jsonResponse({ fulfillment: { id: 'fulfillment-1' } });
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await markOrderPackedInWix('order-db-id', config());

    const wixRequest = requests.find(request => request.url.includes('/create-fulfillment'));
    const orderPatches = requests.filter(request => request.url.includes('/rest/v1/orders') && request.method === 'PATCH');
    assert.equal(wixRequest.method, 'POST');
    assert.equal(wixRequest.body.fulfillment.trackingInfo.trackingNumber, 'AWB123');
    assert.equal('status' in wixRequest.body.fulfillment, false);
    assert.equal(orderPatches[0].body.wix_fulfillment_status, 'pending-fulfillment');
    assert.equal(orderPatches[1].body.wix_fulfillment_status, 'fulfilled');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('fulfills Wix with tracking when an operator explicitly marks the shipment fulfilled', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (String(url).includes('/create-fulfillment')) return jsonResponse({ fulfillment: { id: 'fulfillment-manual' } });
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await fulfillManualShipmentInWix(
      { id: 'order-db-id', wix_order_id: 'wix-order-1', raw_order: { lineItems: [{ id: 'line-1', quantity: 1 }] } },
      { waybill: 'INTL123', courier_code: 'fedex', service_mode: 'FedEx International', tracking_url: 'https://carrier.example/INTL123' },
      config()
    );

    const wixRequest = requests.find(request => request.url.includes('/create-fulfillment'));
    const orderPatches = requests.filter(request => request.url.includes('/rest/v1/orders') && request.method === 'PATCH');
    assert.equal(wixRequest.body.fulfillment.trackingInfo.trackingNumber, 'INTL123');
    assert.equal(wixRequest.body.fulfillment.trackingInfo.trackingLink, 'https://carrier.example/INTL123');
    assert.equal(orderPatches.at(-1).body.fulfillment_status, 'FULFILLED');
    assert.equal(orderPatches.at(-1).body.wix_fulfillment_status, 'fulfilled');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

function config() {
  return {
    wix: {
      authToken: 'token',
      siteId: 'site',
      accountId: '',
      requestTimeoutMs: 30_000,
      fulfillmentSyncEnabled: true,
      trackingUrlTemplate: 'https://track.example/{waybill}'
    },
    delhivery: {}
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload)
  };
}
