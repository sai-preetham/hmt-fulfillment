import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesDashboardQueue } from '../src/store.js';

test('matchesDashboardQueue correctly classifies orders in the 6-stage pipeline', () => {
  // Base paid/approved order
  const orderBase = {
    status: 'APPROVED',
    payment_status: 'PAID',
    shipment_status: null,
    shipment_waybill: null,
    pick_pack_tasks: [],
    buyer_call_status: 'pending'
  };

  // 1. Stage: Needs Packing (Paid/Approved, no waybill, not packed)
  assert.equal(matchesDashboardQueue(orderBase, 'needs_packing'), true);
  assert.equal(matchesDashboardQueue(orderBase, 'needs_booking'), false);

  // 2. Stage: Needs Booking (Packed, no waybill)
  const orderPacked = {
    ...orderBase,
    pick_pack_tasks: [{ status: 'packed' }]
  };
  assert.equal(matchesDashboardQueue(orderPacked, 'needs_packing'), false);
  assert.equal(matchesDashboardQueue(orderPacked, 'needs_booking'), true);

  // 3. Stage: Ready for Pickup (Has waybill, status is booked, not transit)
  const orderBooked = {
    ...orderPacked,
    shipment_waybill: 'AWB12345',
    shipment_status: 'booked'
  };
  assert.equal(matchesDashboardQueue(orderBooked, 'needs_booking'), false);
  assert.equal(matchesDashboardQueue(orderBooked, 'ready_for_pickup'), true);
  assert.equal(matchesDashboardQueue(orderBooked, 'in_transit'), false);

  // 4. Stage: In Transit (Has waybill, status in transit/out-for-delivery)
  const orderTransit = {
    ...orderBooked,
    shipment_status: 'in-transit'
  };
  assert.equal(matchesDashboardQueue(orderTransit, 'ready_for_pickup'), false);
  assert.equal(matchesDashboardQueue(orderTransit, 'in_transit'), true);

  // 5. Stage: Needs Call (Delivered, buyer call status not completed)
  const orderDelivered = {
    ...orderTransit,
    shipment_status: 'delivered'
  };
  assert.equal(matchesDashboardQueue(orderDelivered, 'in_transit'), false);
  assert.equal(matchesDashboardQueue(orderDelivered, 'needs_call'), true);
  assert.equal(matchesDashboardQueue(orderDelivered, 'completed'), false);

  // 6. Stage: Completed (Delivered, buyer call status is completed)
  const orderCompleted = {
    ...orderDelivered,
    buyer_call_status: 'answered_confirmed'
  };
  assert.equal(matchesDashboardQueue(orderCompleted, 'needs_call'), false);
  assert.equal(matchesDashboardQueue(orderCompleted, 'completed'), true);
});

test('matchesDashboardQueue keeps backward-compatible queue and call status aliases', () => {
  const unpackedOrder = {
    status: 'APPROVED',
    payment_status: 'PAID',
    shipment_status: null,
    shipment_waybill: null,
    pick_pack_tasks: []
  };
  assert.equal(matchesDashboardQueue(unpackedOrder, 'needs_shipping'), true);

  const bookedOrder = {
    ...unpackedOrder,
    shipment_status: 'booked',
    shipment_waybill: 'AWB123'
  };
  assert.equal(matchesDashboardQueue(bookedOrder, 'booked'), true);

  const legacyCompletedOrder = {
    ...bookedOrder,
    shipment_status: 'delivered',
    buyer_call_status: 'completed'
  };
  assert.equal(matchesDashboardQueue(legacyCompletedOrder, 'completed'), true);
  assert.equal(matchesDashboardQueue(legacyCompletedOrder, 'needs_call'), false);
});

test('matchesDashboardQueue handles wix failure and international pending filters', () => {
  const orderWixFailed = {
    status: 'APPROVED',
    payment_status: 'PAID',
    wix_fulfillment_status: 'failed'
  };
  assert.equal(matchesDashboardQueue(orderWixFailed, 'wix_update_failed'), true);

  const orderIntlPending = {
    status: 'APPROVED',
    payment_status: 'PAID',
    shipment_status: 'pending-international'
  };
  assert.equal(matchesDashboardQueue(orderIntlPending, 'international_pending'), true);
  assert.equal(matchesDashboardQueue(orderIntlPending, 'needs_packing'), false);
});

test('matchesDashboardQueue treats carrier delivered variants as delivered', () => {
  const order = {
    status: 'APPROVED',
    payment_status: 'PAID',
    shipment_waybill: 'AWB12345',
    shipment_status: 'Delivered to consignee',
    buyer_call_status: 'pending',
    pick_pack_tasks: [{ status: 'packed' }]
  };

  assert.equal(matchesDashboardQueue(order, 'ready_for_pickup'), false);
  assert.equal(matchesDashboardQueue(order, 'needs_call'), true);

  assert.equal(matchesDashboardQueue({ ...order, shipment_status: 'Delivered' }, 'ready_for_pickup'), false);
  assert.equal(matchesDashboardQueue({ ...order, shipment_status: 'Delivered' }, 'needs_call'), true);
});
