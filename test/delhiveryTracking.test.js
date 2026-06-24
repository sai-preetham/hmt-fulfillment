import assert from 'node:assert/strict';
import test from 'node:test';
import {
  courierCodeForTracking,
  fetchDelhiveryTracking,
  groupShipmentsByCourier,
  isDelhiveryInternationalWaybill
} from '../src/delhiveryTracking.js';

test('routes DL...CN international AWBs through Delhivery tracking', () => {
  assert.equal(isDelhiveryInternationalWaybill('DL343934225CN'), true);
  assert.equal(isDelhiveryInternationalWaybill('dl343934225cn'), true);
  assert.equal(isDelhiveryInternationalWaybill('AWB123'), false);

  assert.equal(
    courierCodeForTracking({
      waybill: 'DL343934225CN',
      courier_code: 'shiprocket'
    }),
    'delhivery'
  );
});

test('groups DL...CN AWBs with Delhivery even when courier code differs', () => {
  const grouped = groupShipmentsByCourier([
    { id: '1', waybill: 'DL343934225CN', courier_code: 'shiprocket' },
    { id: '2', waybill: 'SR123', courier_code: 'shiprocket' }
  ]);

  assert.equal(grouped.get('delhivery')[0].id, '1');
  assert.equal(grouped.get('shiprocket')[0].id, '2');
});

test('fetches Delhivery tracking and indexes waybills case-insensitively', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(
      JSON.stringify({
        ShipmentData: [
          {
            Shipment: {
              Waybill: 'dl343934225cn',
              Status: { Status: 'In Transit' },
              Scans: []
            }
          }
        ]
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await fetchDelhiveryTracking(['DL343934225CN'], {
      delhivery: {
        trackingApiUrl: 'https://track.delhivery.com/api/v1/packages/json/',
        token: 'token-1'
      }
    });

    assert.equal(new URL(requests[0].url).searchParams.get('waybill'), 'DL343934225CN');
    assert.equal(requests[0].options.headers.Authorization, 'Token token-1');
    assert.equal(result.get('DL343934225CN').Status.Status, 'In Transit');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
