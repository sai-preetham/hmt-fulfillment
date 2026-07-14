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

test('Wix fulfilled orders without tracking are marked fulfilled in CRM status', async () => {
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
          id: 'order-fulfilled',
          wix_order_id: 'wix-order-fulfilled',
          customer_id: 'customer-fulfilled',
          shipping_address_id: 'ship-fulfilled',
          billing_address_id: 'bill-fulfilled',
          internal_status: 'awaiting_packing',
          shipment_status: 'not_booked',
          shipment_waybill: null,
          awb_number: null
        }
      ]);
    }

    if (table === 'customers' && options.method === 'GET') {
      return jsonResponse([
        {
          id: 'customer-fulfilled',
          wix_contact_id: 'wix-contact-fulfilled',
          name: 'Fulfilled Buyer',
          email: 'fulfilled@example.com',
          phone: '+91 3333333333'
        }
      ]);
    }

    if (table === 'customers' && options.method === 'PATCH') {
      return jsonResponse([{ id: 'customer-fulfilled', ...body }]);
    }

    if (table === 'orders' && options.method === 'POST') {
      return jsonResponse([{ id: 'order-fulfilled', ...body }]);
    }

    return jsonResponse([{ id: `${table}-row`, ...body }]);
  };

  const { upsertWixOrders } = await import(`../src/store.js?fulfilled-crm-${Date.now()}`);
  await upsertWixOrders([
    {
      id: 'wix-order-fulfilled',
      number: 10368,
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      currency: 'INR',
      buyerInfo: {
        contactId: 'wix-contact-fulfilled',
        email: 'fulfilled@example.com'
      },
      shippingInfo: {
        logistics: {
          shippingDestination: {
            contactDetails: {
              firstName: 'Fulfilled',
              lastName: 'Buyer',
              phone: '+91 3333333333'
            },
            address: {
              addressLine: 'Fulfilled shipping address',
              city: 'Bengaluru',
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

  const orderUpsert = requests.find(request => request.table === 'orders' && request.method === 'POST');
  assert.equal(orderUpsert.body.fulfillment_status, 'FULFILLED');
  assert.equal(orderUpsert.body.internal_status, 'fulfilled_no_tracking');
  assert.equal(orderUpsert.body.shipment_status, 'not_booked');
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}
