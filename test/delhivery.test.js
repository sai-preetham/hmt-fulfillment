import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelDelhiveryShipment,
  createDelhiveryPickupRequest,
  mapWixOrderToDelhivery,
  mapWixShippingToInternationalService,
  validatePayload
} from '../src/delhivery.js';

const config = {
  delhivery: {
    clientName: 'Acme Store',
    pickupLocation: 'Main Warehouse',
    returnName: 'Main Warehouse',
    returnAddress: '1 Warehouse Road',
    returnCity: 'Bengaluru',
    returnState: 'KA',
    returnPincode: '560102',
    returnPhone: '9999999999'
  },
  defaults: {
    sellerGstTin: '29ABCDE1234F1Z5',
    hsnCode: '6109',
    weightGrams: 500,
    lengthCm: 10,
    widthCm: 8,
    heightCm: 4,
    paymentMode: 'Prepaid',
    shippingMode: 'E'
  }
};

test('maps Wix order to Delhivery create-order payload', () => {
  const payload = mapWixOrderToDelhivery(sampleOrder(), config);
  const shipment = payload.shipments[0];

  assert.equal(payload.pickup_location.name, 'Main Warehouse');
  assert.equal(shipment.order, '10034');
  assert.equal(shipment.name, 'Jane Doe');
  assert.equal(shipment.pin, '560001');
  assert.equal(shipment.phone, '9876543210');
  assert.equal(shipment.payment_mode, 'Prepaid');
  assert.equal(shipment.md, 'E');
  assert.equal(shipment.shipping_mode, 'Express');
  assert.equal(shipment.shipment_mode, 'Express');
  assert.equal(shipment.client, undefined);
  assert.equal(shipment.total_amount, 1250);
  assert.equal(shipment.quantity, 2);
  assert.match(shipment.products_desc, /Shirt SKU-1 x2/);
});

test('allows a Delhivery order number override for replacement shipments', () => {
  const payload = mapWixOrderToDelhivery(sampleOrder(), config, { orderNumberOverride: '10034-2' });

  assert.equal(payload.shipments[0].order, '10034-2');
});

test('uses CRM delivery overrides when the Wix destination is missing a pincode', () => {
  const order = sampleOrder();
  order.shippingInfo.logistics.shippingDestination.address.postalCode = '';

  const payload = mapWixOrderToDelhivery(order, config, {
    deliveryOverride: {
      address: {
        addressLine: 'Hno222, near holy chowk, bakkkarwala',
        city: 'Delhi',
        subdivision: 'Delhi',
        country: 'IN',
        postalCode: '110041'
      },
      contact: { firstName: 'Swati', lastName: 'Rojha', phone: '7042815870' }
    }
  });

  const shipment = payload.shipments[0];
  assert.equal(shipment.pin, '110041');
  assert.equal(shipment.add, 'Hno222, near holy chowk, bakkkarwala');
  assert.equal(shipment.name, 'Swati Rojha');
  assert.equal(shipment.phone, '7042815870');
  assert.doesNotThrow(() => validatePayload(payload));
});

test('never falls back to the Wix billing address for a shipment destination', () => {
  const order = sampleOrder();
  order.billingInfo = {
    address: { country: 'IN', city: 'Mumbai', postalCode: '400001', addressLine: '1 Billing Street' },
    contactDetails: { firstName: 'Bill', lastName: 'Payer', phone: '9000000000' }
  };
  delete order.shippingInfo.logistics.shippingDestination;

  const payload = mapWixOrderToDelhivery(order, config);
  const shipment = payload.shipments[0];

  assert.equal(shipment.pin, undefined);
  assert.equal(shipment.add, undefined);
  assert.equal(shipment.phone, undefined);
  assert.throws(() => validatePayload(payload), /destination pincode|Missing required Delhivery fields/);
});

test('uses the shipping address rather than a different billing address for international shipments', () => {
  const order = sampleOrder();
  order.shippingInfo.logistics.shippingDestination.address = {
    country: 'US', city: 'New York', subdivision: 'NY', postalCode: '10001', addressLine: '55 Shipping Avenue'
  };
  order.shippingInfo.logistics.shippingDestination.contactDetails = { firstName: 'Ship', lastName: 'Recipient', phone: '2125550100' };
  order.billingInfo = {
    address: { country: 'IN', city: 'Mumbai', postalCode: '400001', addressLine: '1 Billing Street' },
    contactDetails: { firstName: 'Bill', lastName: 'Payer', phone: '9000000000' }
  };

  const payload = mapWixOrderToDelhivery(order, config);

  assert.equal(payload.customer.address, '55 Shipping Avenue');
  assert.equal(payload.customer.postalCode, '10001');
  assert.equal(payload.customer.name, 'Ship Recipient');
});

test('uses COD when order is not paid', () => {
  const order = sampleOrder();
  order.paymentStatus = 'NOT_PAID';
  const payload = mapWixOrderToDelhivery(order, config);

  assert.equal(payload.shipments[0].payment_mode, 'COD');
  assert.equal(payload.shipments[0].cod_amount, 1250);
});

test('maps reverse shipment with pickup payment mode and return details', () => {
  const payload = mapWixOrderToDelhivery(sampleOrder(), config, { reverse: true });
  const shipment = payload.shipments[0];

  assert.equal(shipment.payment_mode, 'Pickup');
  assert.equal(shipment.cod_amount, 0);
  assert.equal(shipment.return_pin, '560102');
  assert.equal(shipment.return_phone, '9999999999');
});

test('validates required Delhivery fields', () => {
  assert.throws(
    () => validatePayload({ shipments: [{ order: '1' }], pickup_location: { name: 'Main Warehouse' } }),
    /Missing required Delhivery fields/
  );
});

test('maps Wix streetAddress into Delhivery address', () => {
  const order = sampleOrder();
  delete order.shippingInfo.logistics.shippingDestination.address.addressLine;
  order.shippingInfo.logistics.shippingDestination.address.streetAddress = {
    name: 'R. Dona Tecla',
    number: '350 - Apto 909'
  };

  const payload = mapWixOrderToDelhivery(order, config);

  assert.equal(payload.shipments[0].add, 'R. Dona Tecla, 350 - Apto 909');
});

test('rejects destinations unsupported by the Delhivery Express order API', () => {
  const order = sampleOrder();
  order.shippingInfo.logistics.shippingDestination.address.country = 'BR';
  order.shippingInfo.logistics.shippingDestination.address.postalCode = '07097380';

  const payload = mapWixOrderToDelhivery(order, config);

  assert.equal(payload.flow, 'international');
  assert.equal(payload.shipment.service, 'DLV Saver');
  assert.equal(payload.customer.country, 'BR');
});

test('maps Wix international express method to Delhivery Deferred Express', () => {
  const order = sampleOrder();
  order.shippingInfo.title = 'International Express (May attract Import duty)';
  order.shippingInfo.logistics.shippingDestination.address.country = 'US';
  order.shippingInfo.logistics.shippingDestination.address.postalCode = '10001';

  const payload = mapWixOrderToDelhivery(order, config);

  assert.equal(payload.flow, 'international');
  assert.equal(payload.shipment.service, 'Deferred Express');
  assert.equal(payload.shipment.wixShippingMethod, 'International Express (May attract Import duty)');
});

test('allows explicit international service override', () => {
  const order = sampleOrder();
  order.shippingInfo.title = 'International Express';
  order.shippingInfo.logistics.shippingDestination.address.country = 'US';
  order.shippingInfo.logistics.shippingDestination.address.postalCode = '10001';

  const payload = mapWixOrderToDelhivery(order, config, { internationalService: 'DLV Saver' });

  assert.equal(payload.flow, 'international');
  assert.equal(payload.shipment.service, 'DLV Saver');
});

test('maps Wix standard method to Delhivery DLV Saver', () => {
  assert.equal(mapWixShippingToInternationalService('Standard (Delivery Duty Paid)'), 'DLV Saver');
  assert.equal(mapWixShippingToInternationalService('International Express'), 'Deferred Express');
});

test('cancels a Delhivery shipment using its AWB and cancellation flag', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await cancelDelhiveryShipment('12345678901234', {
      delhivery: { token: 'test-token', cancelOrderUrl: 'https://example.test/api/p/edit' }
    });
    assert.equal(result.success, true);
    assert.equal(request.url, 'https://example.test/api/p/edit');
    assert.equal(request.options.headers.Authorization, 'Token test-token');
    assert.deepEqual(JSON.parse(request.options.body), { waybill: '12345678901234', cancellation: 'true' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('raises a Delhivery pickup request for a registered warehouse', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ pickup_id: 'pickup-1' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await createDelhiveryPickupRequest({
      pickupLocation: 'Main Warehouse', pickupDate: '2026-08-12', pickupTime: '14:00', expectedPackageCount: 2
    }, { delhivery: { token: 'test-token', pickupRequestUrl: 'https://example.test/fm/request/new/' } });
    assert.equal(result.pickup_id, 'pickup-1');
    assert.equal(request.url, 'https://example.test/fm/request/new/');
    assert.equal(request.options.headers.Authorization, 'Token test-token');
    assert.deepEqual(JSON.parse(request.options.body), {
      pickup_time: '14:00:00', pickup_date: '2026-08-12', pickup_location: 'Main Warehouse', expected_package_count: 2
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sampleOrder() {
  return {
    id: 'order-id',
    number: '10034',
    paymentStatus: 'PAID',
    priceSummary: {
      total: {
        amount: '1250'
      }
    },
    shippingInfo: {
      logistics: {
        shippingDestination: {
          address: {
            country: 'IN',
            subdivision: 'IN-KA',
            city: 'Bengaluru',
            postalCode: '560001',
            addressLine: '12 MG Road'
          },
          contactDetails: {
            firstName: 'Jane',
            lastName: 'Doe',
            phone: '9876543210'
          }
        }
      }
    },
    lineItems: [
      {
        productName: {
          original: 'Shirt'
        },
        quantity: 2,
        physicalProperties: {
          sku: 'SKU-1'
        },
        itemType: {
          preset: 'PHYSICAL'
        }
      }
    ]
  };
}
