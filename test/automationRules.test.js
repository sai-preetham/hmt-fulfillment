import assert from 'node:assert/strict';
import test from 'node:test';
import { isAuthorizedAutomationRequest } from '../lib/crm/automation-auth.js';
import { selectAutomationLane, shouldSkipAutomation } from '../lib/crm/automation.js';

test('automation selects Delhivery Express for paid domestic orders', () => {
  const lane = selectAutomationLane({
    payment_status: 'PAID',
    internal_status: 'new',
    shipping_address: { country: 'IN' }
  });

  assert.equal(lane.lane, 'book_dlh_express');
  assert.equal(lane.courier, 'delhivery');
  assert.equal(lane.serviceCode, 'express');
});

test('automation selects Delhivery DLV Saver for paid international standard orders', () => {
  const lane = selectAutomationLane({
    payment_status: 'APPROVED',
    internal_status: 'new',
    selected_shipping_title: 'International Standard',
    shipping_address: { country: 'US' }
  });

  assert.equal(lane.lane, 'book_dlh_dlv_saver');
  assert.equal(lane.serviceCode, 'dlv_saver');
});

test('automation selects FedEx CSV for paid international express orders', () => {
  const lane = selectAutomationLane({
    payment_status: 'PAID',
    internal_status: 'new',
    selected_shipping_title: 'International Express',
    shipping_address: { country: 'US' }
  });

  assert.equal(lane.lane, 'fedex_csv');
  assert.equal(lane.courier, 'fedex');
});

test('automation skips unpaid cancelled and held orders', () => {
  assert.equal(shouldSkipAutomation({ payment_status: 'PENDING', internal_status: 'new' }), true);
  assert.equal(shouldSkipAutomation({ payment_status: 'PAID', internal_status: 'cancelled' }), true);
  assert.equal(shouldSkipAutomation({ payment_status: 'PAID', internal_status: 'new', automation_hold: true }), true);
});

test('automation status/run APIs require bearer secret when configured', () => {
  const originalSecret = process.env.AUTOMATION_SECRET;
  process.env.AUTOMATION_SECRET = 'secret-1';
  try {
    assert.equal(isAuthorizedAutomationRequest(new Request('http://test', { headers: { Authorization: 'Bearer secret-1' } })), true);
    assert.equal(isAuthorizedAutomationRequest(new Request('http://test', { headers: { Authorization: 'Bearer wrong' } })), false);
  } finally {
    if (originalSecret === undefined) delete process.env.AUTOMATION_SECRET;
    else process.env.AUTOMATION_SECRET = originalSecret;
  }
});
