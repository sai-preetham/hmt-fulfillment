import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractShiprocketTrackingEvents,
  fetchShiprocketTracking,
  getShiprocketLiveLocation,
  getShiprocketLiveStatus,
  normalizeShiprocketStatus
} from '../src/shiprocketTracking.js';

test('normalizes Shiprocket statuses to internal shipment states', () => {
  assert.equal(normalizeShiprocketStatus('Out For Delivery'), 'out-for-delivery');
  assert.equal(normalizeShiprocketStatus('RTO Initiated'), 'rto');
  assert.equal(normalizeShiprocketStatus('Shipment Booked'), 'booked');
  assert.equal(normalizeShiprocketStatus('Custom Cleared Overseas'), 'in-transit');
  assert.equal(normalizeShiprocketStatus('Canceled'), 'failed');
  assert.equal(normalizeShiprocketStatus(7), 'delivered');
  assert.equal(normalizeShiprocketStatus('17'), 'out-for-delivery');
});

test('extracts Shiprocket tracking events', () => {
  const tracking = {
    shipment_track_activities: [
      {
        date: '2026-06-09 10:30:00',
        status: 'In Transit',
        activity: 'Shipment reached hub',
        location: 'Bengaluru'
      }
    ]
  };

  const events = extractShiprocketTrackingEvents(tracking);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_status, 'In Transit');
  assert.equal(events[0].normalized_status, 'in-transit');
  assert.equal(events[0].carrier_location, 'Bengaluru');
  assert.deepEqual(events[0].raw_event, tracking.shipment_track_activities[0]);
});

test('reads Shiprocket current status and location from tracking response', () => {
  const tracking = {
    shipment_status: 'Delivered',
    shipment_track_activities: [
      {
        status: 'Delivered',
        location: 'Mumbai'
      }
    ]
  };

  assert.equal(getShiprocketLiveStatus(tracking), 'Delivered');
  assert.equal(getShiprocketLiveLocation(tracking), 'Mumbai');
});

test('fetches Shiprocket tracking by AWB with bearer auth', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(
      JSON.stringify({
        tracking_data: {
          shipment_status: 'Delivered',
          shipment_track_activities: []
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const result = await fetchShiprocketTracking(['AWB123'], {
      shiprocket: {
        baseUrl: 'https://apiv2.shiprocket.in/v1/external',
        token: 'token-1'
      }
    });

    assert.equal(requests[0].url, 'https://apiv2.shiprocket.in/v1/external/courier/track/awb/AWB123');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer token-1');
    assert.equal(result.get('AWB123').shipment_status, 'Delivered');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
