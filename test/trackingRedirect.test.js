import assert from 'node:assert/strict';
import test from 'node:test';
import { carrierTrackingUrl, normalizeTrackingId, resolveTrackingRedirect } from '../lib/tracking-redirect.js';

test('builds official carrier tracking URLs', () => {
  assert.equal(carrierTrackingUrl('delhivery', '52270010001982'), 'https://www.delhivery.com/track/package/52270010001982');
  assert.equal(carrierTrackingUrl('fedex', '771234567890'), 'https://www.fedex.com/fedextrack/?trknbr=771234567890');
  assert.equal(carrierTrackingUrl('shiprocket', 'SR-12345'), 'https://shiprocket.co/tracking/SR-12345');
});

test('rejects unsafe or malformed tracking IDs', () => {
  assert.equal(normalizeTrackingId('52270010001982'), '52270010001982');
  assert.equal(normalizeTrackingId('../login'), '');
  assert.equal(normalizeTrackingId('x'), '');
});

test('looks up the courier before redirecting', async () => {
  const result = await resolveTrackingRedirect(fakeDb({ waybill: '771234567890', courier_code: 'fedex' }), '771234567890');
  assert.deepEqual(result, { ok: true, url: 'https://www.fedex.com/fedextrack/?trknbr=771234567890' });
});

test('returns not found instead of guessing an unknown shipment', async () => {
  const result = await resolveTrackingRedirect(fakeDb(null), 'UNKNOWN-123');
  assert.equal(result.status, 404);
});

function fakeDb(data, error = null) {
  return { from() { return { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, maybeSingle: async () => ({ data, error }) }; } };
}
