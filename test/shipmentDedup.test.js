import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingShipment, isDuplicateShipmentError, normalizeAwb } from '../lib/crm/shipment-dedup.js';

test('normalizes spaces and case in AWBs', () => {
  assert.equal(normalizeAwb(' 8772 1198 3599 '), '877211983599');
  assert.equal(normalizeAwb('DL346418935XB'), 'dl346418935xb');
});

test('matches the same order and normalized AWB despite courier-label drift', () => {
  const expected = { id: 'shipment-1', order_id: 'order-1', courier_code: 'FedEx', waybill: '8772 1198 3599' };
  assert.equal(findMatchingShipment([expected], {
    orderId: 'order-1', courierCode: 'delhivery', waybill: '877211983599'
  }), expected);
  assert.equal(findMatchingShipment([expected], {
    orderId: 'order-2', courierCode: 'fedex', waybill: '877211983599'
  }), null);
});

test('recognizes Postgres unique violations returned by Supabase', () => {
  assert.equal(isDuplicateShipmentError({ code: '23505' }), true);
  assert.equal(isDuplicateShipmentError({ message: 'duplicate key value violates unique constraint' }), true);
  assert.equal(isDuplicateShipmentError({ message: 'network error' }), false);
});
