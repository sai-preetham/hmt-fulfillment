import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWooCommerceOrder } from '../src/fulfillment.js';
import { isAuthorizedWooIngestRequest } from '../lib/crm/woo-ingest-auth.js';
import { isWooIngestAuthBypassAllowed } from '../lib/auth-guard.js';

test('normalizes WooCommerce order payload for Ops CRM', () => {
  const normalized = normalizeWooCommerceOrder(sampleWooOrder(), {
    defaults: { hsnCode: '90328910', weightGrams: 400 }
  });

  assert.equal(normalized.order.source, 'woocommerce');
  assert.equal(normalized.order.woo_order_id, '12045');
  assert.equal(normalized.order.external_order_id, '12045');
  assert.equal(normalized.order.order_number, '12045');
  assert.equal(normalized.order.payment_status, 'paid');
  assert.equal(normalized.order.total_amount, 14999);
  assert.equal(normalized.customer.name, 'Asha Verma');
  assert.equal(normalized.customer.email, 'asha@example.com');
  assert.equal(normalized.customer.phone, '9876543210');
  assert.equal(normalized.shippingAddress.city, 'Bengaluru');
  assert.equal(normalized.shippingAddress.postal_code, '560102');
  assert.equal(normalized.items[0].sku, 'HMT-CRUISE-R3');
  assert.equal(normalized.items[0].quantity, 1);
  assert.equal(normalized.items[0].product_name, 'HMT Cruise Kit - Yamaha R3');
});

test('accepts wrapped Woo payloads and maps pending payment', () => {
  const pending = sampleWooOrder();
  pending.status = 'pending';
  pending.date_paid = null;
  pending.date_paid_gmt = null;
  const normalized = normalizeWooCommerceOrder({ order: pending });
  assert.equal(normalized.order.payment_status, 'pending');
  assert.equal(normalized.order.status, 'pending');
});

test('Woo ingest auth accepts x-ops-woo-secret or Bearer', () => {
  const env = { WOO_OPS_INGEST_SECRET: 'woo-secret' };
  const headerReq = {
    headers: new Headers({ 'x-ops-woo-secret': 'woo-secret' })
  };
  const bearerReq = {
    headers: new Headers({ authorization: 'Bearer woo-secret' })
  };
  const badReq = {
    headers: new Headers({ 'x-ops-woo-secret': 'nope' })
  };
  assert.equal(isAuthorizedWooIngestRequest(headerReq, env), true);
  assert.equal(isAuthorizedWooIngestRequest(bearerReq, env), true);
  assert.equal(isAuthorizedWooIngestRequest(badReq, env), false);
  assert.equal(isAuthorizedWooIngestRequest(headerReq, { WOO_OPS_INGEST_SECRET: '' }), false);
});

test('proxy bypass allows Woo ingest path with shared secret', () => {
  const env = { WOO_OPS_INGEST_SECRET: 'woo-secret' };
  const ok = {
    nextUrl: { pathname: '/api/integrations/woocommerce/orders' },
    headers: new Headers({ 'x-ops-woo-secret': 'woo-secret' })
  };
  const wrongPath = {
    nextUrl: { pathname: '/api/integrations/amazon/sync' },
    headers: new Headers({ 'x-ops-woo-secret': 'woo-secret' })
  };
  assert.equal(isWooIngestAuthBypassAllowed(ok, env), true);
  assert.equal(isWooIngestAuthBypassAllowed(wrongPath, env), false);
});

function sampleWooOrder() {
  return {
    id: 12045,
    number: '12045',
    status: 'processing',
    currency: 'INR',
    date_created: '2026-09-19T10:00:00',
    date_created_gmt: '2026-09-19T04:30:00',
    date_modified_gmt: '2026-09-19T04:35:00',
    date_paid: '2026-09-19T10:01:00',
    total: '14999.00',
    shipping_total: '0.00',
    total_tax: '0.00',
    discount_total: '0.00',
    payment_method: 'razorpay',
    payment_method_title: 'Razorpay',
    transaction_id: 'pay_test_123',
    billing: {
      first_name: 'Asha',
      last_name: 'Verma',
      email: 'asha@example.com',
      phone: '9876543210',
      address_1: '12 5th Cross',
      address_2: 'HSR Layout',
      city: 'Bengaluru',
      state: 'KA',
      postcode: '560102',
      country: 'IN'
    },
    shipping: {
      first_name: 'Asha',
      last_name: 'Verma',
      phone: '9876543210',
      address_1: '12 5th Cross',
      address_2: 'HSR Layout',
      city: 'Bengaluru',
      state: 'KA',
      postcode: '560102',
      country: 'IN'
    },
    line_items: [
      {
        id: 55,
        name: 'HMT Cruise Kit - Yamaha R3',
        product_id: 901,
        variation_id: 0,
        quantity: 1,
        sku: 'HMT-CRUISE-R3',
        price: 14999,
        subtotal: '14999.00',
        total: '14999.00',
        total_tax: '0.00',
        taxes: []
      }
    ],
    shipping_lines: [{ method_title: 'Free shipping', method_id: 'free_shipping' }]
  };
}
