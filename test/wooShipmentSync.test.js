import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHmtShipmentMetaData,
  HMT_WOO_SHIPMENT_META_KEYS,
  normalizeCarrierSlug,
  normalizeShipmentStatus,
  updateWooCommerceOrderShipmentMeta
} from '../src/woocommerce.js';
import {
  isWooCommerceOrder,
  syncShipmentTrackingToWoo,
  writeWooShipmentOnBooked,
  writeWooShipmentOnPickedUp
} from '../src/wooShipmentSync.js';
import { syncBookedShipmentToWix } from '../src/booking.js';

function wooConfig(overrides = {}) {
  return {
    wix: { trackingUrlTemplate: 'https://www.delhivery.com/track/package/{waybill}' },
    delhivery: { trackingUrlTemplate: 'https://www.delhivery.com/track/package/{waybill}' },
    fedex: { trackingUrlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={waybill}' },
    shiprocket: { trackingUrlTemplate: 'https://www.shiprocket.in/shipment-tracking/{waybill}' },
    woocommerce: {
      baseUrl: 'https://wp-staging.holdmythrottle.com',
      consumerKey: 'ck_test',
      consumerSecret: 'cs_test',
      shipmentWriteback: { enabled: true },
      ...overrides.woocommerce
    },
    ...overrides
  };
}

test('woocombot meta keys and builder are stable', () => {
  assert.deepEqual(HMT_WOO_SHIPMENT_META_KEYS, {
    carrier: '_hmt_carrier',
    awb: '_hmt_awb',
    trackingUrl: '_hmt_tracking_url',
    shipmentStatus: '_hmt_shipment_status',
    opsShipmentId: '_hmt_ops_shipment_id',
    opsSyncedAt: '_hmt_ops_synced_at'
  });

  const meta = buildHmtShipmentMetaData({
    carrier: 'Delhivery',
    awb: 'AWB123',
    trackingUrl: 'https://www.delhivery.com/track/package/AWB123',
    shipmentStatus: 'picked-up',
    opsShipmentId: 'ship-uuid-1',
    syncedAt: '2026-09-19T12:00:00.000Z'
  });
  assert.deepEqual(
    Object.fromEntries(meta.map(row => [row.key, row.value])),
    {
      _hmt_carrier: 'delhivery',
      _hmt_awb: 'AWB123',
      _hmt_tracking_url: 'https://www.delhivery.com/track/package/AWB123',
      _hmt_shipment_status: 'picked_up',
      _hmt_ops_shipment_id: 'ship-uuid-1',
      _hmt_ops_synced_at: '2026-09-19T12:00:00.000Z'
    }
  );
  assert.equal(normalizeCarrierSlug('ShipRocket'), 'shiprocket');
  assert.equal(normalizeShipmentStatus('shipment_booked'), 'booked');
});

test('updateWooCommerceOrderShipmentMeta PUTs meta_data only (no status)', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ id: 555, meta_data: calls[0].body.meta_data }) };
  };

  await updateWooCommerceOrderShipmentMeta(
    555,
    {
      carrier: 'fedex',
      awb: 'FX123',
      trackingUrl: 'https://www.fedex.com/fedextrack/?trknbr=FX123',
      shipmentStatus: 'booked',
      opsShipmentId: 'ops-ship-1',
      syncedAt: '2026-09-19T12:00:00.000Z'
    },
    wooConfig(),
    { fetchImpl }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].url, /\/wp-json\/wc\/v3\/orders\/555$/);
  assert.equal(calls[0].body.status, undefined);
  assert.equal(calls[0].body.meta_data.length, 6);
  assert.equal(calls[0].body.meta_data.find(m => m.key === '_hmt_awb').value, 'FX123');
  assert.match(calls[0].headers.Authorization, /^Basic /);
});

test('write-back skips when flag off, non-woo order, or missing AWB', async () => {
  const fetchImpl = async () => {
    throw new Error('fetch should not run');
  };
  assert.equal(
    (await syncShipmentTrackingToWoo(
      { source: 'woocommerce', woo_order_id: '1' },
      { waybill: 'A1' },
      wooConfig({ woocommerce: { shipmentWriteback: { enabled: false } } }),
      { fetchImpl }
    )).reason,
    'disabled'
  );
  assert.equal(
    (await syncShipmentTrackingToWoo(
      { source: 'wix', wix_order_id: 'w1' },
      { waybill: 'A1' },
      wooConfig(),
      { fetchImpl }
    )).reason,
    'not-woo-order'
  );
  assert.equal(
    (await writeWooShipmentOnBooked(
      { source: 'woocommerce', woo_order_id: '1' },
      { id: 's1' },
      wooConfig(),
      { fetchImpl }
    )).reason,
    'no-waybill'
  );
  assert.equal(isWooCommerceOrder({ source: 'woocommerce', woo_order_id: '9' }), true);
  assert.equal(isWooCommerceOrder({ source: 'wix', woo_order_id: '9' }), false);
});

test('booked and picked_up write-back send correct _hmt_shipment_status', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ id: 777 }) };
  };
  const order = { id: 'ops-1', source: 'woocommerce', woo_order_id: '777' };
  const shipment = {
    id: 'ship-1',
    waybill: 'DLV999',
    courier_code: 'delhivery',
    tracking_url: 'https://www.delhivery.com/track/package/DLV999'
  };

  const booked = await writeWooShipmentOnBooked(order, shipment, wooConfig(), { fetchImpl });
  assert.equal(booked.ok, true);
  assert.equal(calls[0].meta_data.find(m => m.key === '_hmt_shipment_status').value, 'booked');
  assert.equal(calls[0].status, undefined);

  const picked = await writeWooShipmentOnPickedUp(order, shipment, wooConfig(), { fetchImpl });
  assert.equal(picked.ok, true);
  assert.equal(calls[1].meta_data.find(m => m.key === '_hmt_shipment_status').value, 'picked_up');
  assert.equal(calls[1].meta_data.find(m => m.key === '_hmt_ops_shipment_id').value, 'ship-1');
});

test('write-back soft-fails on Woo HTTP errors without throwing', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ message: 'boom' })
  });
  const result = await syncShipmentTrackingToWoo(
    { source: 'woocommerce', woo_order_id: '1' },
    { id: 's', waybill: 'A1', courier_code: 'delhivery' },
    wooConfig(),
    { fetchImpl }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /500/);
});

function jsonResponse(payload) {
  const body = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => body
  };
}

test('booking syncBookedShipmentToWix invokes Woo write-back only for woo orders when enabled', async () => {
  const originalFetch = globalThis.fetch;
  const wooPuts = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/orders') && (options.method || 'GET') === 'GET') {
      return jsonResponse([{ id: 'order-db-id', source: 'woocommerce', woo_order_id: '888' }]);
    }
    if (u.includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id' }]);
    }
    if (u.includes('/wp-json/wc/v3/orders/') && options.method === 'PUT') {
      wooPuts.push(JSON.parse(options.body));
      return jsonResponse({ id: 888 });
    }
    throw new Error(`Unexpected ${options.method || 'GET'} ${u}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await syncBookedShipmentToWix(
      {
        id: 'order-db-id',
        source: 'woocommerce',
        woo_order_id: '888',
        raw_order: { lineItems: [] }
      },
      { id: 'ship-db', waybill: 'AWB777', status: 'booked', courier_code: 'delhivery' },
      wooConfig()
    );
    assert.equal(wooPuts.length, 1);
    assert.equal(wooPuts[0].meta_data.find(m => m.key === '_hmt_awb').value, 'AWB777');
    assert.equal(wooPuts[0].meta_data.find(m => m.key === '_hmt_shipment_status').value, 'booked');

    wooPuts.length = 0;
    await syncBookedShipmentToWix(
      {
        id: 'order-db-id',
        source: 'wix',
        wix_order_id: 'wix-1',
        raw_order: { lineItems: [] }
      },
      { id: 'ship-db', waybill: 'AWB777', status: 'booked', courier_code: 'delhivery' },
      wooConfig()
    );
    assert.equal(wooPuts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
