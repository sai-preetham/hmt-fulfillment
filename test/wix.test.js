import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { buildSearchOrdersRequest, decodeWixEvent, getOrderIdFromWixEvent } from '../src/wix.js';

test('decodes and verifies HS256 webhook JWT when a secret is configured', () => {
  const jwt = signHs256({ id: 'event-1', entityId: 'order-1' }, 'secret');
  const decoded = decodeWixEvent({ jwt }, { wix: { webhookSecret: 'secret' } });

  assert.equal(decoded.verified, true);
  assert.equal(decoded.payload.entityId, 'order-1');
});

test('finds order ID from common Wix event shapes', () => {
  assert.equal(getOrderIdFromWixEvent({ entityId: 'a' }), 'a');
  assert.equal(getOrderIdFromWixEvent({ order: { id: 'b' } }), 'b');
  assert.equal(getOrderIdFromWixEvent({ createdEvent: { entity: { id: 'c' } } }), 'c');
});

test('builds Wix search orders request with filters and cursor paging', () => {
  const request = buildSearchOrdersRequest({
    limit: 500,
    cursor: 'next-cursor',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'NOT_FULFILLED'
  });

  assert.deepEqual(request, {
    search: {
      cursorPaging: {
        limit: 100,
        cursor: 'next-cursor'
      },
      filter: {
        paymentStatus: 'PAID',
        fulfillmentStatus: 'NOT_FULFILLED'
      },
      sort: [
        {
          fieldName: 'createdDate',
          order: 'DESC'
        }
      ]
    }
  });
});

function signHs256(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
