import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrderShipmentSummary, normalizeShipmentRecord, normalizeWixOrder } from '../src/fulfillment.js';
import { upsertWixFulfillmentTracking } from '../src/store.js';
import { getCourierAdapter, listCourierServices } from '../src/couriers/index.js';

test('normalizes Wix order into customer, order, items, and payment refs', () => {
  const normalized = normalizeWixOrder(sampleOrder(), { defaults: { hsnCode: '90328910' } });

  assert.equal(normalized.customer.email, 'buyer@example.com');
  assert.equal(normalized.shippingAddress.postal_code, '560001');
  assert.equal(normalized.order.wix_order_id, 'order-id');
  assert.equal(normalized.order.total_amount, 1299);
  assert.equal(normalized.items[0].sku, 'SKU-1');
  assert.equal(normalized.payment.payment_status, 'PAID');
});

test('normalizes shipment record without deleting raw request and response data', () => {
  const record = normalizeShipmentRecord({
    orderId: 'order-id',
    orderNumber: '1001',
    status: 'booked',
    shippingMode: 'S',
    waybill: 'awb-1',
    requestPayload: {
      shipments: [
        {
          order: '1001',
          md: 'S',
          shipment_length: 23,
          shipment_width: 15,
          shipment_height: 5,
          weight: 400
        }
      ],
      pickup_location: { name: 'Warehouse' }
    },
    delhiveryResponse: { success: true }
  });

  assert.equal(record.courier_code, 'delhivery');
  assert.equal(record.courier_service_code, 'surface');
  assert.equal(record.request_payload.shipments[0].order, '1001');
  assert.equal(record.carrier_response.success, true);
});

test('builds order shipment summary with awb and service details', () => {
  const summary = buildOrderShipmentSummary(
    {
      status: 'booked',
      waybill: 'awb-1',
      courier_code: 'delhivery',
      courier_service_code: 'surface',
      service_mode: 'Surface',
      updated_at: '2026-06-04T10:00:00.000Z'
    },
    '2026-06-04T10:01:00.000Z'
  );

  assert.equal(summary.shipment_status, 'booked');
  assert.equal(summary.shipment_waybill, 'awb-1');
  assert.equal(summary.shipment_courier_code, 'delhivery');
  assert.equal(summary.shipment_service_code, 'surface');
  assert.equal(summary.shipment_service_mode, 'Surface');
  assert.equal(summary.shipment_booked_at, '2026-06-04T10:00:00.000Z');
  assert.equal(summary.shipment_updated_at, '2026-06-04T10:00:00.000Z');
});

test('does not mark order shipment as booked until an awb exists', () => {
  const summary = buildOrderShipmentSummary(
    {
      status: 'pending',
      courier_code: 'delhivery',
      courier_service_code: 'express',
      service_mode: 'Express'
    },
    '2026-06-04T10:01:00.000Z'
  );

  assert.equal(summary.shipment_status, 'pending');
  assert.equal(summary.shipment_waybill, null);
  assert.equal(summary.shipment_booked_at, null);
  assert.equal(summary.shipment_updated_at, '2026-06-04T10:01:00.000Z');
});

test('preserves booked timestamp when later shipment updates still have an awb', () => {
  const summary = buildOrderShipmentSummary(
    {
      status: 'in-transit',
      waybill: 'awb-1',
      courier_code: 'delhivery',
      courier_service_code: 'surface',
      service_mode: 'Surface',
      updated_at: '2026-06-04T10:30:00.000Z'
    },
    '2026-06-04T10:31:00.000Z'
  );

  assert.equal(Object.hasOwn(summary, 'shipment_booked_at'), false);
  assert.equal(summary.shipment_status, 'in-transit');
  assert.equal(summary.shipment_waybill, 'awb-1');
});

test('moves delivered shipment summaries to installation follow-up', () => {
  const summary = buildOrderShipmentSummary(
    {
      status: 'delivered',
      waybill: 'awb-1',
      courier_code: 'delhivery',
      updated_at: '2026-06-04T10:30:00.000Z'
    },
    '2026-06-04T10:31:00.000Z'
  );

  assert.equal(summary.shipment_status, 'delivered');
  assert.equal(summary.internal_status, 'installation_pending');
});

test('lists configured courier adapters', () => {
  assert.equal(getCourierAdapter('delhivery').code, 'delhivery');
  assert.equal(getCourierAdapter('shiprocket').code, 'shiprocket');
  assert.equal(getCourierAdapter('shree_maruti').code, 'shree_maruti');
  assert.equal(listCourierServices().some(courier => courier.code === 'shiprocket'), true);
  assert.equal(listCourierServices().some(courier => courier.code === 'shree_maruti'), true);
});

test('persists tracking details pulled from Wix fulfillments', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/shipments?legacy_order_id')) {
      return jsonResponse([]);
    }
    if (String(url).includes('/rest/v1/shipments') && options.method === 'POST') {
      return jsonResponse([
        {
          id: 'shipment-id',
          order_id: 'order-db-id',
          legacy_order_id: 'wix-order-id',
          order_number: '1001',
          status: 'booked',
          waybill: 'AWB-WIX-1',
          courier_code: 'delhivery'
        }
      ]);
    }
    if (String(url).includes('/rest/v1/shipment_attempts') && (options.method || 'GET') === 'GET') {
      return jsonResponse([]);
    }
    if (String(url).includes('/rest/v1/shipment_attempts') && options.method === 'POST') {
      return jsonResponse([{ id: 'attempt-id' }]);
    }
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (String(url).includes('/rest/v1/audit_log') && options.method === 'POST') {
      return jsonResponse([{ id: 'audit-id' }]);
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    const result = await upsertWixFulfillmentTracking(
      {
        id: 'order-db-id',
        wix_order_id: 'wix-order-id',
        order_number: '1001'
      },
      [
        {
          id: 'fulfillment-id',
          createdDate: '2026-06-10T08:09:21.460Z',
          trackingInfo: {
            trackingNumber: 'AWB-WIX-1',
            shippingProvider: 'Express',
            trackingLink: 'https://www.delhivery.com/track/package/AWB-WIX-1'
          }
        }
      ]
    );

    const shipmentPost = requests.find(request => request.url.includes('/rest/v1/shipments') && request.method === 'POST');
    assert.equal(result.persisted, 1);
    assert.equal(shipmentPost.body.waybill, 'AWB-WIX-1');
    assert.equal(shipmentPost.body.courier_code, 'delhivery');
    assert.equal(shipmentPost.body.carrier_response.trackingInfo.trackingLink, 'https://www.delhivery.com/track/package/AWB-WIX-1');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test('does not downgrade delivered shipments when Wix fulfillment only has tracking', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/rest/v1/shipments?legacy_order_id')) {
      return jsonResponse([
        {
          id: 'shipment-id',
          order_id: 'order-db-id',
          legacy_order_id: 'wix-order-id',
          order_number: '1001',
          status: 'delivered',
          waybill: 'AWB-WIX-1',
          courier_code: 'delhivery'
        }
      ]);
    }
    if (String(url).includes('/rest/v1/shipments') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'shipment-id', order_id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (String(url).includes('/rest/v1/orders') && options.method === 'PATCH') {
      return jsonResponse([{ id: 'order-db-id', ...requests.at(-1).body }]);
    }
    if (String(url).includes('/rest/v1/shipment_attempts') && (options.method || 'GET') === 'GET') {
      return jsonResponse([]);
    }
    if (String(url).includes('/rest/v1/shipment_attempts') && options.method === 'POST') {
      return jsonResponse([{ id: 'attempt-id' }]);
    }
    if (String(url).includes('/rest/v1/audit_log') && options.method === 'POST') {
      return jsonResponse([{ id: 'audit-id' }]);
    }
    throw new Error(`Unexpected request ${options.method || 'GET'} ${url}`);
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  try {
    await upsertWixFulfillmentTracking(
      {
        id: 'order-db-id',
        wix_order_id: 'wix-order-id',
        order_number: '1001'
      },
      [
        {
          id: 'fulfillment-id',
          trackingInfo: {
            trackingNumber: 'AWB-WIX-1',
            shippingProvider: 'Express'
          }
        }
      ]
    );

    const shipmentPatch = requests.find(request => request.url.includes('/rest/v1/shipments') && request.method === 'PATCH');
    const orderPatch = requests.find(request => request.url.includes('/rest/v1/orders') && request.method === 'PATCH');
    assert.equal(shipmentPatch.body.status, 'delivered');
    assert.equal(orderPatch.body.shipment_status, 'delivered');
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

function sampleOrder() {
  return {
    id: 'order-id',
    number: '1001',
    status: 'APPROVED',
    paymentStatus: 'PAID',
    fulfillmentStatus: 'NOT_FULFILLED',
    currency: 'INR',
    createdDate: '2026-06-01T00:00:00.000Z',
    updatedDate: '2026-06-01T00:00:00.000Z',
    buyerInfo: {
      contactId: 'contact-id',
      email: 'buyer@example.com'
    },
    priceSummary: {
      subtotal: { amount: '1000' },
      shipping: { amount: '299' },
      tax: { amount: '0' },
      discount: { amount: '0' },
      total: { amount: '1299' }
    },
    balanceSummary: {
      paid: { amount: '1299' },
      refunded: { amount: '0' },
      authorized: { amount: '0' }
    },
    shippingInfo: {
      title: 'Standard',
      logistics: {
        shippingDestination: {
          address: {
            country: 'IN',
            city: 'Bengaluru',
            postalCode: '560001',
            addressLine: '12 MG Road'
          },
          contactDetails: {
            firstName: 'Test',
            lastName: 'Buyer',
            phone: '9999999999'
          }
        }
      }
    },
    lineItems: [
      {
        id: 'line-1',
        productName: { original: 'Product' },
        quantity: 1,
        price: { amount: '1299' },
        totalPriceAfterTax: { amount: '1299' },
        physicalProperties: { sku: 'SKU-1', weight: 0.4 }
      }
    ]
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}
