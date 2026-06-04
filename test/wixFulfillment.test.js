import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrackingUrl, createWixFulfillment } from '../src/wixFulfillment.js';

test('creates Wix fulfillment with awb tracking details', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      text: async () => JSON.stringify({ fulfillment: { id: 'fulfillment-1' } })
    };
  };

  try {
    const result = await createWixFulfillment(
      {
        wix_order_id: 'wix-order-1',
        raw_order: {
          lineItems: [{ id: 'line-1', quantity: 2 }]
        }
      },
      {
        waybill: 'awb-1',
        service_mode: 'Express'
      },
      config()
    );

    assert.equal(result.status, 'synced');
    assert.equal(result.fulfillmentId, 'fulfillment-1');
    assert.equal(request.url, 'https://www.wixapis.com/ecom/v1/fulfillments/orders/wix-order-1/create-fulfillment');
    assert.equal(request.body.fulfillment.trackingInfo.trackingNumber, 'awb-1');
    assert.equal(request.body.fulfillment.trackingInfo.shippingProvider, 'Express');
    assert.equal(request.body.fulfillment.lineItems[0].id, 'line-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('builds tracking url from template', () => {
  assert.equal(buildTrackingUrl('awb 1', config()), 'https://track.example/awb%201');
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
