import test from 'node:test';
import assert from 'node:assert/strict';
import { isAwaitingWarehousePickup, canConfirmPickup } from '../lib/crm/pickup.js';

const shipment = { waybill: 'AWB123', status: 'booked', direction: 'forward' };
test('all carriers show booked shipments awaiting pickup', () => {
  for (const courier_code of ['delhivery', 'fedex', 'manual']) {
    for (const status of ['booked', 'shipment_booked', 'pickup_pending', 'pickup-error']) {
      assert.equal(isAwaitingWarehousePickup({ ...shipment, courier_code, status }), true);
    }
  }
});
test('unbooked, unsuccessful, reverse and collected shipments do not await pickup', () => {
  for (const status of ['pending', 'pending-zone', 'pending-international', 'failed', 'cancelled', 'canceled', 'returned', 'rto', 'picked_up', 'in-transit', 'delivered']) {
    assert.equal(isAwaitingWarehousePickup({ ...shipment, status }), false, status);
  }
  assert.equal(isAwaitingWarehousePickup({ ...shipment, waybill: ' ' }), false);
  assert.equal(isAwaitingWarehousePickup({ ...shipment, direction: 'reverse' }), false);
});
test('pickup retries accept collected shipments but reject inactive shipments', () => {
  for (const status of ['picked_up', 'in-transit', 'delivered']) assert.equal(canConfirmPickup({ ...shipment, status }), true);
  for (const status of ['pending', 'failed', 'cancelled', 'returned']) assert.equal(canConfirmPickup({ ...shipment, status }), false);
  assert.equal(canConfirmPickup({ ...shipment, direction: 'reverse' }), false);
});

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { code } = transformSync(readFileSync(new URL('../lib/crm/data.js', import.meta.url), 'utf8'), {
  filename: 'data.js', jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' }
});

function pickupHarness({ status = 'booked', wix = true, syncFails = false } = {}) {
  let row = { ...shipment, id: 'shipment-1', order_id: 'order-1', status };
  let order = { id: 'order-1', wix_order_id: wix ? 'wix-1' : null };
  let calls = 0;
  const client = { from(table) {
    let patch;
    const query = {
      select() { return query; }, eq() { return query; },
      update(value) { patch = value; return query; },
      maybeSingle: async () => ({ data: row }),
      single: async () => { row = { ...row, ...patch }; return { data: row }; },
      then(resolve) { return Promise.resolve({ error: null }).then(resolve); }
    };
    return query;
  } };
  const mocks = {
    './pickup.js': { isAwaitingWarehousePickup, canConfirmPickup },
    '@/lib/supabase/server': { createServiceClient: () => client },
    './order-search': {}, '@/src/shipmentValidation.js': {}, './seed': {},
    '@/src/store.js': { findOrderById: async () => order },
    '@/src/config.js': { getConfig: () => ({ wix: { fulfillmentSyncEnabled: true } }) },
    './data-settings': { getCrmSettings: async () => ({}) },
    './settings': { applyCrmSettingsToConfig: config => config },
    '@/src/wixShipmentSync.js': { fulfillManualShipmentInWix: async (_, picked) => {
      calls++;
      assert.equal(picked.status, status === 'booked' ? 'picked-up' : status);
      order = { ...order, wix_fulfillment_status: syncFails ? 'failed' : 'fulfilled', wix_fulfillment_error: syncFails ? 'Wix unavailable' : null };
    } }
  };
  const exports = {};
  runInNewContext(code, { exports, require: name => { if (!(name in mocks)) throw new Error(name); return mocks[name]; } });
  return { run: () => exports.markShipmentPickedUp('order-1', 'shipment-1'), calls: () => calls };
}

test('manual pickup records collection and fulfills Wix', async () => {
  const harness = pickupHarness();
  const result = await harness.run();
  assert.equal(result.ok, true);
  assert.equal(result.shipment.status, 'picked-up');
  assert.equal(harness.calls(), 1);
});
test('Wix failure reports partial success and preserves pickup', async () => {
  const harness = pickupHarness({ syncFails: true });
  const result = await harness.run();
  assert.equal(result.ok, false);
  assert.equal(result.shipment.status, 'picked-up');
  assert.match(result.error, /Wix unavailable/);
});
test('retry does not regress delivery status', async () => {
  const result = await pickupHarness({ status: 'delivered' }).run();
  assert.equal(result.ok, true);
  assert.equal(result.shipment.status, 'delivered');
});
test('non-Wix pickup does not call Wix', async () => {
  const harness = pickupHarness({ wix: false });
  assert.equal((await harness.run()).ok, true);
  assert.equal(harness.calls(), 0);
});
test('inactive shipment cannot trigger fulfillment', async () => {
  const harness = pickupHarness({ status: 'cancelled' });
  assert.equal((await harness.run()).ok, false);
  assert.equal(harness.calls(), 0);
});
