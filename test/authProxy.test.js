import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthRequired, isAutomationAuthBypassAllowed, isLocalAuthBypassAllowed } from '../lib/auth-guard.js';

function requestFor(hostname, pathname = '/', authorization = '') {
  return {
    nextUrl: {
      hostname,
      pathname
    },
    headers: new Headers(authorization ? { authorization } : {})
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

test('automation bearer bypass is limited to protected automation APIs', () => {
  const env = { AUTOMATION_SECRET: 'secret-1' };
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/automation/run', 'Bearer secret-1'), env), true);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/tracking/sync', 'Bearer secret-1'), env), true);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/api/automation/run', 'Bearer wrong'), env), false);
  assert.equal(isAutomationAuthBypassAllowed(requestFor('ops.holdmythrottle.com', '/orders', 'Bearer secret-1'), env), false);
});
