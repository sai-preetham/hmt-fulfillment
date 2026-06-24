import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeFedexStatus,
  getFedexLiveStatus,
  getFedexLiveLocation,
  extractFedexTrackingEvents,
  fetchFedexTracking
} from '../src/fedexTracking.js';

test('normalizeFedexStatus maps status codes to system states', () => {
  assert.equal(normalizeFedexStatus('DL'), 'delivered');
  assert.equal(normalizeFedexStatus('Delivered'), 'delivered');
  assert.equal(normalizeFedexStatus('PU'), 'picked-up');
  assert.equal(normalizeFedexStatus('Picked Up'), 'picked-up');
  assert.equal(normalizeFedexStatus('IT'), 'in-transit');
  assert.equal(normalizeFedexStatus('In Transit'), 'in-transit');
  assert.equal(normalizeFedexStatus('OC'), 'booked');
  assert.equal(normalizeFedexStatus('Initiated'), 'booked');
  assert.equal(normalizeFedexStatus('DE'), 'failed');
  assert.equal(normalizeFedexStatus('Exception'), 'failed');
  assert.equal(normalizeFedexStatus('CA'), 'failed');
  assert.equal(normalizeFedexStatus('Cancelled'), 'failed');
  assert.equal(normalizeFedexStatus('unknown_dummy'), 'in-transit');
  assert.equal(normalizeFedexStatus(''), 'booked');
});

test('getFedexLiveStatus reads status from tracking package info', () => {
  const pkg = {
    latestStatusDetail: {
      derivedStatus: 'DELIVERED',
      description: 'Delivered',
      code: 'DL'
    }
  };
  assert.equal(getFedexLiveStatus(pkg), 'DELIVERED');

  const pkg2 = {
    latestStatusDetail: {
      description: 'Picked up',
      code: 'PU'
    }
  };
  assert.equal(getFedexLiveStatus(pkg2), 'Picked up');

  const pkgError = {
    error: ['Something went wrong']
  };
  assert.equal(getFedexLiveStatus(pkgError), 'unknown');
});

test('getFedexLiveLocation returns formatted location', () => {
  const pkg = {
    latestStatusDetail: {
      scanLocation: {
        city: 'MEMPHIS',
        stateOrProvinceCode: 'TN'
      }
    }
  };
  assert.equal(getFedexLiveLocation(pkg), 'MEMPHIS, TN');

  const pkg2 = {
    lastUpdatedDestinationAddress: {
      city: 'BENGALURU',
      countryCode: 'IN'
    }
  };
  assert.equal(getFedexLiveLocation(pkg2), 'BENGALURU, IN');
});

test('extractFedexTrackingEvents parses scanEvents', () => {
  const pkg = {
    scanEvents: [
      {
        date: '2026-06-24T10:00:00Z',
        derivedStatus: 'DELIVERED',
        eventDescription: 'Package delivered',
        scanLocation: {
          city: 'MEMPHIS',
          stateOrProvinceCode: 'TN'
        }
      },
      {
        date: '2026-06-24T05:00:00Z',
        derivedStatus: 'IN_TRANSIT',
        eventDescription: 'Package in transit',
        scanLocation: {
          city: 'CHICAGO',
          stateOrProvinceCode: 'IL'
        }
      }
    ]
  };

  const events = extractFedexTrackingEvents(pkg);
  assert.equal(events.length, 2);
  assert.equal(events[0].event_status, 'DELIVERED');
  assert.equal(events[0].normalized_status, 'delivered');
  assert.equal(events[0].carrier_location, 'MEMPHIS, TN');
  assert.equal(events[0].message, 'Package delivered');
  assert.equal(events[0].occurred_at, '2026-06-24T10:00:00.000Z');

  assert.equal(events[1].normalized_status, 'in-transit');
});

test('fetchFedexTracking fetches tracking info via OAuth and track endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/oauth/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'mock-fedex-token',
          expires_in: 3600
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/track/v1/trackingnumbers')) {
      return new Response(
        JSON.stringify({
          output: {
            completeTrackResults: [
              {
                trackingNumber: '123456789012',
                trackResults: [
                  {
                    latestStatusDetail: {
                      derivedStatus: 'IN_TRANSIT'
                    }
                  }
                ]
              }
            ]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('', { status: 404 });
  };

  try {
    const result = await fetchFedexTracking(['123456789012'], {
      fedex: {
        baseUrl: 'https://apis-sandbox.fedex.com',
        clientId: 'mock-id',
        clientSecret: 'mock-secret'
      }
    });

    assert.equal(requests.length, 2);
    // Auth request validation
    assert.ok(requests[0].url.includes('/oauth/token'));
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');

    // Track request validation
    assert.ok(requests[1].url.includes('/track/v1/trackingnumbers'));
    assert.equal(requests[1].options.headers.Authorization, 'Bearer mock-fedex-token');
    const reqBody = JSON.parse(requests[1].options.body);
    assert.equal(reqBody.trackingInfo[0].trackingNumberInfo.trackingNumber, '123456789012');

    // Mapped results validation
    assert.ok(result.has('123456789012'));
    assert.equal(result.get('123456789012').latestStatusDetail.derivedStatus, 'IN_TRANSIT');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
