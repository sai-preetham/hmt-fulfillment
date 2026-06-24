import assert from 'node:assert/strict';
import test from 'node:test';

test('Wix resync preserves CRM-edited addresses and buyer GST', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').pop();
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ table, method: options.method || 'GET', query: parsed.searchParams.toString(), body });

    if (table === 'orders' && options.method === 'GET') {
      return jsonResponse([
        {
          id: 'order-1',
          wix_order_id: 'wix-order-1',
          customer_id: 'customer-1',
          shipping_address_id: 'ship-crm-1',
          billing_address_id: 'bill-crm-1'
        }
      ]);
    }

    if (table === 'customers' && options.method === 'GET') {
      return jsonResponse([
        {
          id: 'customer-1',
          wix_contact_id: 'wix-contact-1',
          name: 'CRM Buyer',
          email: 'crm@example.com',
          phone: '+91 9000000000',
          tax_id: '19GMSPM3198B1ZG',
          tax_id_type: 'GSTIN'
        }
      ]);
    }

    if (table === 'customers' && options.method === 'PATCH') {
      return jsonResponse([{ id: 'customer-1', ...body }]);
    }

    if (table === 'orders' && options.method === 'POST') {
      return jsonResponse([{ id: 'order-1', ...body }]);
    }

    return jsonResponse([{ id: `${table}-row`, ...body }]);
  };

  const { upsertWixOrders } = await import(`../src/store.js?preserve-crm-${Date.now()}`);
  await upsertWixOrders([
    {
      id: 'wix-order-1',
      number: 10366,
      paymentStatus: 'PAID',
      fulfillmentStatus: 'NOT_FULFILLED',
      currency: 'INR',
      buyerInfo: {
        contactId: 'wix-contact-1',
        email: 'wix@example.com'
      },
      billingInfo: {
        contactDetails: {
          firstName: 'Wix',
          lastName: 'Buyer',
          phone: '+91 1111111111'
        },
        address: {
          addressLine: 'Wix billing address',
          city: 'Wix City',
          country: 'IN'
        }
      },
      shippingInfo: {
        logistics: {
          shippingDestination: {
            contactDetails: {
              firstName: 'Wix',
              lastName: 'Buyer',
              phone: '+91 1111111111'
            },
            address: {
              addressLine: 'Wix shipping address',
              city: 'Wix City',
              country: 'IN'
            }
          }
        }
      },
      priceSummary: {
        total: { amount: '1000.00' }
      },
      balanceSummary: {
        paid: { amount: '1000.00' }
      },
      lineItems: []
    }
  ]);

  const customerPatch = requests.find(request => request.table === 'customers' && request.method === 'PATCH');
  assert.equal(customerPatch.body.tax_id, '19GMSPM3198B1ZG');
  assert.equal(customerPatch.body.tax_id_type, 'GSTIN');
  assert.equal(customerPatch.body.email, 'crm@example.com');

  const orderUpsert = requests.find(request => request.table === 'orders' && request.method === 'POST');
  assert.equal(orderUpsert.body.shipping_address_id, 'ship-crm-1');
  assert.equal(orderUpsert.body.billing_address_id, 'bill-crm-1');

  const addressWrites = requests.filter(request => request.table === 'customer_addresses');
  assert.equal(addressWrites.length, 0);
});

test('Wix resync skips unchanged source version append', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

  const wixOrder = {
    id: 'wix-order-unchanged',
    number: 10367,
    paymentStatus: 'PAID',
    fulfillmentStatus: 'NOT_FULFILLED',
    currency: 'INR',
    buyerInfo: {
      contactId: 'wix-contact-unchanged',
      email: 'buyer@example.com'
    },
    billingInfo: {
      contactDetails: {
        firstName: 'Same',
        lastName: 'Buyer',
        phone: '+91 2222222222'
      },
      address: {
        addressLine: 'Same billing address',
        city: 'Same City',
        country: 'IN'
      }
    },
    shippingInfo: {
      logistics: {
        shippingDestination: {
          contactDetails: {
            firstName: 'Same',
            lastName: 'Buyer',
            phone: '+91 2222222222'
          },
          address: {
            addressLine: 'Same shipping address',
            city: 'Same City',
            country: 'IN'
          }
        }
      }
    },
    priceSummary: {
      total: { amount: '1000.00' }
    },
    balanceSummary: {
      paid: { amount: '1000.00' }
    },
    lineItems: []
  };

  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').pop();
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ table, method: options.method || 'GET', query: parsed.searchParams.toString(), body });

    if (table === 'orders' && options.method === 'GET') {
      return jsonResponse([
        {
          id: 'order-unchanged',
          wix_order_id: 'wix-order-unchanged',
          customer_id: 'customer-unchanged',
          shipping_address_id: 'ship-unchanged',
          billing_address_id: 'bill-unchanged',
          raw_order: wixOrder
        }
      ]);
    }

    if (table === 'customers' && options.method === 'GET') {
      return jsonResponse([
        {
          id: 'customer-unchanged',
          wix_contact_id: 'wix-contact-unchanged',
          name: 'Same Buyer',
          email: 'buyer@example.com',
          phone: '+91 2222222222'
        }
      ]);
    }

    if (table === 'customers' && options.method === 'PATCH') {
      return jsonResponse([{ id: 'customer-unchanged', ...body }]);
    }

    if (table === 'orders' && options.method === 'POST') {
      return jsonResponse([{ id: 'order-unchanged', ...body }]);
    }

    return jsonResponse([{ id: `${table}-row`, ...body }]);
  };

  const { upsertWixOrders } = await import(`../src/store.js?skip-source-version-${Date.now()}`);
  await upsertWixOrders([wixOrder]);

  const sourceVersionWrites = requests.filter(request => request.table === 'order_source_versions');
  assert.equal(sourceVersionWrites.length, 0);
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}
