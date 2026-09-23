import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthRequired, isAutomationAuthBypassAllowed, isLocalAuthBypassAllowed, isPublicRoute, isWooIngestAuthBypassAllowed } from '../lib/auth-guard.js';

function requestFor(hostname, pathname = '/', authorization = '') {
  return {
    nextUrl: {
      hostname,
      pathname
    },
    headers: new Headers({ host: hostname, ...(authorization ? { authorization } : {}) })
  };
}

test('auth is required by default in production', () => {
  assert.equal(isAuthRequired({ NODE_ENV: 'production' }), true);
});

test('production auth cannot be disabled by AUTH_REQUIRED=false', () => {
  assert.equal(isAuthRequired({ NODE_ENV: 'production', AUTH_REQUIRED: 'false' }), true);
});

test('development auth can be disabled explicitly', () => {
  assert.equal(isAuthRequired({ NODE_ENV: 'development', AUTH_REQUIRED: 'false' }), false);
});

test('localhost auth bypass is disabled in production', () => {
  assert.equal(isLocalAuthBypassAllowed(requestFor('localhost'), { NODE_ENV: 'production' }), false);
});

test('localhost auth bypass remains available in development', () => {
  assert.equal(isLocalAuthBypassAllowed(requestFor('localhost'), { NODE_ENV: 'development' }), true);
});

test('only the bulk document page is publicly accessible', () => {
  assert.equal(isPublicRoute(requestFor('ops.holdmythrottle.com', '/bulk')), true);
  assert.equal(isPublicRoute(requestFor('ops.holdmythrottle.com', '/bulk/')), true);
  assert.equal(isPublicRoute(requestFor('ops.holdmythrottle.com', '/bulk/orders')), false);
  assert.equal(isPublicRoute(requestFor('ops.holdmythrottle.com', '/orders')), false);
});

test('tracking IDs are public only on the tracking hostname', () => {
  assert.equal(isPublicRoute(requestFor('track.holdmythrottle.com', '/52270010001982')), true);
  assert.equal(isPublicRoute(requestFor('ops.holdmythrottle.com', '/52270010001982')), false);
  assert.equal(isPublicRoute(requestFor('track.holdmythrottle.com', '/orders')), false);
});

test('automation bearer bypass is limited to protected automation APIs', () => {
  const env = { AUTOMATION_SECRET: 'secret-1' };
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/automation/run', 'Bearer secret-1'), env), true);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/tracking/sync', 'Bearer secret-1'), env), true);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/integrations/chatwoot/daily-report', 'Bearer secret-1'), env), true);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/automation/run', 'Bearer wrong'), env), false);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/orders', 'Bearer secret-1'), env), false);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/integrations/woocommerce/sync', 'Bearer secret-1'), env), true);
});

test('Woo ingest secret bypass is limited to woocommerce integration APIs', () => {
  const env = { WOO_OPS_INGEST_SECRET: 'woo-secret' };
  assert.equal(
    isWooIngestAuthBypassAllowed(
      { nextUrl: { pathname: '/api/integrations/woocommerce/orders' }, headers: new Headers({ 'x-ops-woo-secret': 'woo-secret' }) },
      env
    ),
    true
  );
  assert.equal(
    isWooIngestAuthBypassAllowed(
      { nextUrl: { pathname: '/api/integrations/woocommerce/orders' }, headers: new Headers({ authorization: 'Bearer woo-secret' }) },
      env
    ),
    true
  );
  assert.equal(
    isWooIngestAuthBypassAllowed(
      { nextUrl: { pathname: '/orders' }, headers: new Headers({ 'x-ops-woo-secret': 'woo-secret' }) },
      env
    ),
    false
  );
});
