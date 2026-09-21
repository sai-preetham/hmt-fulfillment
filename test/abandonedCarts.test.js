import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecoveryMatch, normalizePhone } from '../lib/crm/abandoned-cart-matching.js';
import { normalizeWooCommerceAbandonedCart } from '../lib/crm/abandoned-carts.js';

const created = '2026-08-01T10:00:00.000Z';
const later = '2026-08-03T10:00:00.000Z';

test('matches a later paid order by Wix contact ID before any fallback', () => {
  const lead = { wix_created_at: created, email: 'customer@example.com', raw_data: { buyerInfo: { contactId: 'contact-1' } } };
  const orders = [{ id: 'wrong-email', source_created_at: later, customers: { wix_contact_id: 'other', email: 'customer@example.com' } }, { id: 'correct-contact', source_created_at: later, customers: { wix_contact_id: 'contact-1' } }];
  assert.deepEqual(findRecoveryMatch(lead, orders), { order: orders[1], method: 'wix_contact_id' });
});

test('uses normalized email then phone only when the cart has no Wix contact ID', () => {
  const emailLead = { wix_created_at: created, email: ' Customer@Example.com ', raw_data: {} };
  const emailOrder = { id: 'email-match', source_created_at: later, customers: { email: 'customer@example.com' } };
  assert.equal(findRecoveryMatch(emailLead, [emailOrder]).method, 'email');
  const phoneLead = { wix_created_at: created, phone: '+91 98765 43210', raw_data: {} };
  const phoneOrder = { id: 'phone-match', source_created_at: later, customers: { phone: '9876543210' } };
  assert.equal(findRecoveryMatch(phoneLead, [phoneOrder]).method, 'phone');
  assert.equal(normalizePhone('+91 98765 43210'), '9876543210');
});

test('does not match orders placed before the abandoned checkout', () => {
  const lead = { wix_created_at: created, email: 'customer@example.com', raw_data: {} };
  const order = { id: 'old-order', source_created_at: '2026-07-31T10:00:00.000Z', customers: { email: 'customer@example.com' } };
  assert.equal(findRecoveryMatch(lead, [order]), null);
});

test('normalizes WooCommerce checkout drafts for the shared recovery queue', () => {
  const lead = normalizeWooCommerceAbandonedCart({
    id: 12045, status: 'checkout-draft', currency: 'INR', total: '14999.00',
    date_created_gmt: '2026-09-21T05:00:00', date_modified_gmt: '2026-09-21T05:10:00',
    payment_url: 'https://www.holdmythrottle.com/checkout/order-pay/12045/?key=wc_key',
    billing: { first_name: 'John', last_name: 'Doe', email: 'john@example.com', phone: '9876543210' },
    line_items: [{ name: 'HMT Cruise Kit - Himalayan 450', quantity: 1 }]
  });
  assert.equal(lead.source, 'woocommerce');
  assert.equal(lead.external_cart_id, '12045');
  assert.equal(lead.customer_name, 'John Doe');
  assert.equal(lead.cart_value, 14999);
  assert.equal(lead.checkout_url, 'https://www.holdmythrottle.com/checkout/order-pay/12045/?key=wc_key');
  assert.equal(lead.wix_created_at, '2026-09-21T05:00:00Z');
});
