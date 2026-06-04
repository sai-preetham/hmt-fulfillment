import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrderShipmentSummary, normalizeShipmentRecord, normalizeWixOrder } from '../src/fulfillment.js';
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

test('lists Delhivery and Shree Maruti courier adapters', () => {
  assert.equal(getCourierAdapter('delhivery').code, 'delhivery');
  assert.equal(getCourierAdapter('shree_maruti').code, 'shree_maruti');
  assert.equal(listCourierServices().some(courier => courier.code === 'shree_maruti'), true);
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
