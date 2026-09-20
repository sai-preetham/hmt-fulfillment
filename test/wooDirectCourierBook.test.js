import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWooCommerceOrderToDelhivery } from '../src/delhivery.js';
import { delhiveryAdapter } from '../src/couriers/delhivery.js';
import { fedexAdapter } from '../src/couriers/fedex.js';
import { isWooCommerceRawOrder, isWooCommerceSource, wooCommerceOrderToWixLike } from '../src/wooOrderShape.js';
import {
  directCourierBookingDeniedReason,
  hasDirectCourierBookingIdentity,
  isDirectCourierBookableSource,
  normalizeDirectBookingSource
} from '../lib/crm/direct-courier-booking.js';

const delhiveryConfig = {
  delhivery: {
    pickupLocation: 'HSR GDP',
    returnName: 'Main Warehouse',
    returnAddress: '1 Warehouse Road',
    returnCity: 'Bengaluru',
    returnState: 'KA',
    returnPincode: '560102',
    returnPhone: '9999999999'
  },
  defaults: {
    sellerGstTin: '29ABCDE1234F1Z5',
    hsnCode: '90328910',
    weightGrams: 400,
    lengthCm: 23,
    widthCm: 15,
    heightCm: 5,
    paymentMode: 'Prepaid',
    shippingMode: 'E'
  }
};

test('direct courier gate allows woocommerce and woo aliases', () => {
  assert.equal(isDirectCourierBookableSource('woocommerce'), true);
  assert.equal(isDirectCourierBookableSource('woo'), true);
  assert.equal(isDirectCourierBookableSource('WooCommerce'), true);
  assert.equal(isDirectCourierBookableSource('wix'), true);
  assert.equal(isDirectCourierBookableSource('amazon'), true);
  assert.equal(isDirectCourierBookableSource('manual'), false);
  assert.equal(isDirectCourierBookableSource(''), true); // empty source defaults to wix legacy
  assert.equal(normalizeDirectBookingSource('WOO'), 'woo');
});

test('direct courier gate keeps manual orders on manual AWB', () => {
  assert.equal(
    directCourierBookingDeniedReason({ source: 'manual', external_order_id: 'MAN-1' }),
    'Direct courier booking is currently wired for Wix, Amazon, and WooCommerce orders. Use manual AWB save for manual orders.'
  );
  assert.equal(
    directCourierBookingDeniedReason({ source: 'woocommerce' }),
    'Direct courier booking is currently wired for Wix, Amazon, and WooCommerce orders. Use manual AWB save for manual orders.'
  );
  assert.equal(
    directCourierBookingDeniedReason({
      source: 'woocommerce',
      woo_order_id: '12045',
      external_order_id: '12045'
    }),
    null
  );
  assert.equal(hasDirectCourierBookingIdentity({ woo_order_id: '12045' }), true);
  assert.equal(hasDirectCourierBookingIdentity({ external_order_id: '12045' }), true);
  assert.equal(hasDirectCourierBookingIdentity({}), false);
});

test('detects Woo REST raw orders and rejects Wix/Amazon shapes', () => {
  assert.equal(isWooCommerceRawOrder(sampleWooOrder()), true);
  assert.equal(isWooCommerceSource('woocommerce'), true);
  assert.equal(isWooCommerceSource('woo'), true);
  assert.equal(isWooCommerceSource('wix'), false);
  assert.equal(
    isWooCommerceRawOrder({
      id: 'wix-1',
      lineItems: [{ name: 'Kit' }],
      shippingInfo: {},
      priceSummary: { total: { amount: '1' } }
    }),
    false
  );
  assert.equal(
    isWooCommerceRawOrder({
      order: { AmazonOrderId: 'A1' },
      address: { PostalCode: '560001' },
      buyer: { BuyerName: 'Test' }
    }),
    false
  );
});

test('maps WooCommerce order to Delhivery with totals, items, and prepaid mode', () => {
  const mapped = mapWooCommerceOrderToDelhivery(sampleWooOrder(), delhiveryConfig);
  const shipment = mapped.shipments[0];
  assert.equal(mapped.pickup_location.name, 'HSR GDP');
  assert.equal(shipment.order, '12045');
  assert.equal(shipment.name, 'Asha Verma');
  assert.equal(shipment.city, 'Bengaluru');
  assert.equal(shipment.pin, '560102');
  assert.equal(shipment.phone, '9876543210');
  assert.equal(shipment.payment_mode, 'Prepaid');
  assert.equal(shipment.cod_amount, 0);
  assert.equal(shipment.total_amount, 14999);
  assert.equal(shipment.quantity, 1);
  assert.match(shipment.products_desc, /HMT Cruise Kit - Yamaha R3 HMT-CRUISE-R3 x1/);
  assert.match(shipment.add, /12 5th Cross/);
});

test('maps Woo COD orders to Delhivery COD payment mode', () => {
  const cod = sampleWooOrder();
  cod.payment_method = 'cod';
  cod.payment_method_title = 'Cash on delivery';
  const shipment = mapWooCommerceOrderToDelhivery(cod, delhiveryConfig).shipments[0];
  assert.equal(shipment.payment_mode, 'COD');
  assert.equal(shipment.cod_amount, 14999);
});

test('applies CRM deliveryOverride on Woo Delhivery mapping', () => {
  const mapped = mapWooCommerceOrderToDelhivery(sampleWooOrder(), delhiveryConfig, {
    deliveryOverride: {
      address: { postalCode: '560034', city: 'Bangalore' },
      contact: { phone: '9000000000', firstName: 'Ops', lastName: 'Override' }
    }
  });
  assert.equal(mapped.shipments[0].pin, '560034');
  assert.equal(mapped.shipments[0].city, 'Bangalore');
  assert.equal(mapped.shipments[0].phone, '9000000000');
  assert.equal(mapped.shipments[0].name, 'Ops Override');
});

test('Delhivery adapter routes Woo raw orders to Woo mapper', () => {
  const mapped = delhiveryAdapter.mapOrder(sampleWooOrder(), delhiveryConfig);
  assert.equal(mapped.shipments[0].order, '12045');
  assert.equal(mapped.shipments[0].total_amount, 14999);
});

test('FedEx adapter accepts Woo raw orders via Wix-like view', () => {
  const wixLike = wooCommerceOrderToWixLike(sampleWooOrder());
  assert.equal(wixLike.number, '12045');
  assert.equal(wixLike.priceSummary.total.amount, '14999.00');
  assert.equal(wixLike.lineItems[0].productName.original, 'HMT Cruise Kit - Yamaha R3');

  const mapped = fedexAdapter.mapOrder(sampleWooOrder(), {
    fedex: { accountNumber: '123' },
    defaults: delhiveryConfig.defaults
  }, {
    deliveryOverride: {
      address: {
        addressLine: '12 5th Cross',
        city: 'Bengaluru',
        subdivision: 'KA',
        postalCode: '560102',
        country: 'US'
      },
      contact: { firstName: 'Asha', lastName: 'Verma', phone: '9876543210' }
    }
  });
  assert.equal(mapped.flow, 'international');
  assert.equal(mapped.provider, 'fedex');
  assert.ok(mapped.requestedShipment || mapped.accountNumber || mapped.labelResponseOptions);
});

function sampleWooOrder() {
  return {
    id: 12045,
    number: '12045',
    status: 'processing',
    currency: 'INR',
    date_paid: '2026-09-19T10:01:00',
    total: '14999.00',
    payment_method: 'razorpay',
    payment_method_title: 'Razorpay',
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
        quantity: 1,
        sku: 'HMT-CRUISE-R3',
        price: 14999,
        total: '14999.00'
      }
    ]
  };
}
