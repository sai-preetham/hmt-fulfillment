import assert from 'node:assert/strict';
import test from 'node:test';
import { createWixOrderSync } from '../src/wixOrderSync.js';

test('syncs updated Wix orders across bounded pages', async () => {
  const calls = [];
  const sync = createWixOrderSync(testConfig({ maxPages: 2 }), {
    logger: silentLogger(),
    searchOrders: async options => {
      calls.push(options);
      return {
        orders: [{ id: `order-${calls.length}` }],
        pagingMetadata: calls.length === 1 ? { cursors: { next: 'cursor-2' } } : {}
      };
    },
    upsertOrders: async orders => orders
  });

  const result = await sync.run('test');

  assert.equal(result.lastPulled, 2);
  assert.equal(result.lastPersisted, 2);
  assert.equal(result.lastPages, 2);
  assert.equal(calls[0].sortField, 'updatedDate');
  assert.equal(calls[0].sortOrder, 'DESC');
  assert.equal(calls[1].cursor, 'cursor-2');
});

test('does not overlap sync runs', async () => {
  let release;
  const blockingSearch = new Promise(resolve => {
    release = resolve;
  });
  const sync = createWixOrderSync(testConfig(), {
    logger: silentLogger(),
    searchOrders: async () => {
      await blockingSearch;
      return { orders: [], pagingMetadata: {} };
    },
    upsertOrders: async orders => orders
  });

  const firstRun = sync.run('first');
  const secondRun = await sync.run('second');
  release();
  await firstRun;

  assert.equal(secondRun.skipped, true);
  assert.equal(secondRun.reason, 'already-running');
});

function testConfig(overrides = {}) {
  return {
    wix: {
      authToken: 'wix-token',
      siteId: 'site-id',
      orderSync: {
        enabled: true,
        intervalMs: 60_000,
        pageSize: 100,
        maxPages: 3,
        ...overrides
      }
    },
    supabase: {
      url: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key'
    }
  };
}

function silentLogger() {
  return {
    log() {},
    error() {}
  };
}
