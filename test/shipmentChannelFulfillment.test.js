import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTrackingPickupFulfillHandler,
  fulfillChannelsForTrackingStatusChange,
  fulfillShipmentChannelsOnPickup,
  isPickedUpOrLater,
  shouldSkipWixFulfillment
} from '../src/shipmentChannelFulfillment.js';
import { syncShipmentTrackingToWix } from '../src/wixShipmentSync.js';

function baseConfig(overrides = {}) {
  return {
    wix: {
      authToken: 'token',
      siteId: 'site',
      accountId: '',
      requestTimeoutMs: 30_000,
      fulfillmentSyncEnabled: true,
      trackingUrlTemplate: 'https://track.example/{waybill}',
      ...(overrides.wix || {})
    },
    delhivery: { trackingUrlTemplate: 'https://www.delhivery.com/track/package/{waybill}' },
    fedex: { trackingUrlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={waybill}' },
    shiprocket: { trackingUrlTemplate: 'https://www.shiprocket.in/shipment-tracking/{waybill}' },
    woocommerce: {
      baseUrl: 'https://wp-staging.example',
      consumerKey: 'ck_test',
      consumerSecret: 'cs_test',
      shipmentWriteback: { enabled: true },
      ...(overrides.woocommerce || {})
    },
    ...overrides
  };
}

function jsonResponse(payload) {
  const body = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => body
  };
}

test('isPickedUpOrLater covers picked-up through delivered', () => {
  for (const status of ['picked-up', 'picked_up', 'dispatched', 'in-transit', 'out-for-delivery', 'delivered']) {
    assert.equal(isPickedUpOrLater(status), true, status);
  }
  assert.equal(isPickedUpOrLater('booked'), false);
  assert.equal(isPickedUpOrLater('awaiting-pickup'), false);
});

test('shouldSkipWixFulfillment is idempotent for same AWB already fulfilled', () => {
  assert.equal(
    shouldSkipWixFulfillment(
      {
        wix_order_id: 'w1',
        wix_fulfillment_status: 'fulfilled',
        wix_fulfillment_id: 'f1',
        awb_number: 'AWB1'
      },
      { waybill: 'AWB1' }
    ),
    true
  );
  assert.equal(
    shouldSkipWixFulfillment(
      { wix_order_id: 'w1', wix_fulfillment_status: 'awaiting-pickup', awb_number: 'AWB1' },
      { waybill: 'AWB1' }
    ),
    false
  );
});

test('booked sync still does not create Wix fulfillment', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/rest/v1/orders') && (options.method || 'GET') === 'GET') {
      return jsonResponse([{ id: 'o1', wix_order_id: 'w1', raw_order: { lineItems: [] } }]);
    }
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'o1' }]);
    }
    throw new Error(`Unexpected ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  try {
    await syncShipmentTrackingToWix(
      { id: 'o1', wix_order_id: 'w1', raw_order: { lineItems: [] } },
      { waybill: 'AWB-BOOK', status: 'booked' },
      baseConfig()
    );
    assert.equal(requests.some(r => r.url.includes('/create-fulfillment')), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('tracking status picked-up fulfills Wix', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let order = {
    id: 'order-1',
    wix_order_id: 'wix-1',
    wix_fulfillment_status: 'awaiting-pickup',
    awb_number: 'AWB-TRACK',
    raw_order: { lineItems: [{ id: 'l1', quantity: 1 }] }
  };
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url: String(url), method, body });
    if (String(url).includes('/rest/v1/orders') && method === 'GET') return jsonResponse([order]);
    if (String(url).includes('/rest/v1/orders') && method === 'PATCH') {
      order = { ...order, ...body };
      return jsonResponse([{ ...order }]);
    }
    if (String(url).includes('/create-fulfillment')) {
      return jsonResponse({ fulfillment: { id: 'ful-track' } });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  try {
    const result = await fulfillChannelsForTrackingStatusChange(
      { id: 'ship-1', order_id: 'order-1', waybill: 'AWB-TRACK', status: 'in-transit', courier_code: 'delhivery' },
      baseConfig()
    );
    assert.equal(requests.some(r => r.url.includes('/create-fulfillment')), true);
    assert.equal(order.wix_fulfillment_status, 'fulfilled');
    assert.ok(result.wix);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('tracking status before pickup skips channel fulfill', async () => {
  const result = await fulfillChannelsForTrackingStatusChange(
    { id: 'ship-1', order_id: 'order-1', waybill: 'AWB1', status: 'booked' },
    baseConfig()
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'status-before-pickup');
});


test('fulfillShipmentChannelsOnPickup writes Woo meta via tracking handler', async () => {
  const originalFetch = globalThis.fetch;
  const wooPuts = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/wp-json/wc/v3/orders/') && options.method === 'PUT') {
      wooPuts.push(JSON.parse(options.body));
      return jsonResponse({ id: 777 });
    }
    throw new Error(`Unexpected ${options.method || 'GET'} ${u}`);
  };
  try {
    const handler = createTrackingPickupFulfillHandler(baseConfig(), {
      findOrderById: async () => ({
        id: 'o1',
        source: 'woocommerce',
        woo_order_id: '777'
      })
    });
    const result = await handler({
      id: 's1',
      order_id: 'o1',
      waybill: 'AWB777',
      courier_code: 'fedex',
      status: 'out-for-delivery',
      tracking_url: 'https://www.fedex.com/fedextrack/?trknbr=AWB777'
    });
    assert.equal(wooPuts.length, 1);
    assert.equal(wooPuts[0].meta_data.find(m => m.key === '_hmt_awb').value, 'AWB777');
    assert.equal(wooPuts[0].meta_data.find(m => m.key === '_hmt_shipment_status').value, 'picked_up');
    assert.equal(result.woo.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Woo write-back fail-closed when flag disabled', async () => {
  const handler = createTrackingPickupFulfillHandler(
    baseConfig({ woocommerce: { shipmentWriteback: { enabled: false }, baseUrl: 'https://wp.example', consumerKey: 'ck', consumerSecret: 'cs' } }),
    {
      findOrderById: async () => ({ id: 'o1', source: 'woocommerce', woo_order_id: '9' })
    }
  );
  const result = await handler({
    id: 's1',
    order_id: 'o1',
    waybill: 'A1',
    status: 'picked-up',
    courier_code: 'delhivery'
  });
  assert.equal(result.woo.skipped, true);
  assert.equal(result.woo.reason, 'disabled');
});

test('idempotent Wix skip when already fulfilled for same AWB', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('should not call network when already fulfilled');
  };
  try {
    const result = await fulfillShipmentChannelsOnPickup(
      {
        id: 'o1',
        wix_order_id: 'w1',
        wix_fulfillment_status: 'fulfilled',
        wix_fulfillment_id: 'f1',
        awb_number: 'AWB1',
        raw_order: { lineItems: [] }
      },
      { id: 's1', waybill: 'AWB1', status: 'picked-up' },
      baseConfig()
    );
    assert.equal(result.wix.skipped, true);
    assert.equal(result.wix.reason, 'already-fulfilled');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
