import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInvoiceModel, buildInvoicePdf } from '../lib/crm/invoice-pdf.js';

test('builds Indian tax invoice with 18% GST included in final price', () => {
  process.env.DEFAULT_SELLER_GST_TIN = '29ABCDE1234F1Z5';
  const model = buildInvoiceModel({
    order: {
      id: 'order-1',
      order_number: '10400',
      customer_name: 'Buyer',
      buyer_gst: '29BUYER1234F1Z9',
      buyer_gst_type: 'GSTIN',
      shipping_country: 'IN',
      billing_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 1180,
      discount_amount: 20,
      shipping_amount: 0,
      currency: 'INR'
    },
    items: [{
      product_name: 'HMT Cruise Kit',
      sku: 'HMT-CRUISE',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 1200,
      total_price: 1180
    }],
    payment: {
      payment_method: 'UPI',
      paid_amount: 1180,
      raw_payment: {
        activities: [{ type: 'payment_captured', createdDate: '2026-06-12T08:05:00.000Z' }]
      }
    }
  });

  assert.equal(model.isIndia, true);
  assert.equal(model.seller.gstin, '29ABCDE1234F1Z5');
  assert.equal(model.buyer.gstin, '29BUYER1234F1Z9');
  assert.equal(model.items[0].hsn, '87141090');
  assert.equal(model.items[0].unitPrice, 1200);
  assert.equal(model.items[0].discount, 20);
  assert.equal(model.items[0].taxableValue, 1000);
  assert.equal(model.items[0].taxAmount, 180);
  assert.equal(model.totals.taxableValue, 1000);
  assert.equal(model.totals.taxAmount, 180);
  assert.equal(model.totals.grandTotal, 1180);
  assert.equal(model.invoice.paymentDate, '12 Jun 2026');
});

test('builds outside-India invoice with no GST charged', () => {
  process.env.DEFAULT_HSN_CODE = 'DEFAULT-HSN';
  const model = buildInvoiceModel({
    order: {
      id: 'order-2',
      order_number: '10401',
      customer_name: 'Export Buyer',
      shipping_country: 'US',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 100,
      discount_amount: 0,
      shipping_amount: 0,
      currency: 'USD'
    },
    items: [{
      product_name: 'Mirror Mount',
      hsn_code: '',
      quantity: 1,
      item_price: 100,
      total_price: 100
    }]
  });

  assert.equal(model.isIndia, false);
  assert.equal(model.items[0].hsn, 'DEFAULT-HSN');
  assert.equal(model.items[0].taxableValue, 100);
  assert.equal(model.items[0].taxAmount, 0);
  assert.equal(model.totals.taxableValue, 100);
  assert.equal(model.totals.taxAmount, 0);
  assert.equal(model.totals.grandTotal, 100);
});

test('renders A4 invoice PDF with seller, metadata, item table, and terms', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-3',
      order_number: '10402',
      customer_name: 'Buyer',
      awb_number: 'AWB-123',
      shipping_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 1180,
      currency: 'INR'
    },
    items: [{
      product_name: 'HMT Cruise Kit',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 1180,
      total_price: 1180
    }]
  }).toString('latin1');

  assert.match(pdf, /\/MediaBox \[0 0 595 842\]/);
  assert.match(pdf, /HOLD MY THROTTLE/);
  assert.match(pdf, /BYKR TECH PRIVATE LIMITED/);
  assert.match(pdf, /Email: store@bykr\.co/);
  assert.match(pdf, /Phone: \+91 8904137604/);
  assert.match(pdf, /GSTIN:/);
  assert.match(pdf, /Invoice No\.:/);
  assert.match(pdf, /10402/);
  assert.match(pdf, /AWB:/);
  assert.match(pdf, /AWB-123/);
  assert.match(pdf, /Ship To:/);
  assert.match(pdf, /Billing To:/);
  assert.match(pdf, /Name/);
  assert.match(pdf, /SKU/);
  assert.match(pdf, /HSN/);
  assert.match(pdf, /Qty/);
  assert.match(pdf, /Unit Price/);
  assert.match(pdf, /Tax/);
  assert.match(pdf, /Total/);
  assert.match(pdf, /Payment Summary/);
  assert.match(pdf, /By paying, you agree to all T&C mentioned on the website\./);
  assert.doesNotMatch(pdf, /\d+ \d+ Td \(BYKR TECH\) Tj/);
});

test('uses latest shipment waybill as invoice AWB when order AWB is missing', () => {
  const model = buildInvoiceModel({
    order: {
      id: 'order-awb',
      order_number: '10405',
      customer_name: 'Buyer',
      shipping_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 1180,
      currency: 'INR'
    },
    shipments: [
      { waybill: 'OLD-AWB', updated_at: '2026-06-10T08:00:00.000Z' },
      { waybill: 'LATEST-AWB', updated_at: '2026-06-12T08:00:00.000Z' }
    ],
    items: [{
      product_name: 'HMT Cruise Kit',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 1180,
      total_price: 1180
    }]
  });

  assert.equal(model.invoice.awb, 'LATEST-AWB');
});

test('international label uses selected line-item quantity and adds destination calling code', () => {
  const pdf = buildInvoicePdf({
    order: {
      order_number: '10452',
      quantity: 1,
      customer_name: 'Export Buyer',
      shipping_phone: '0479 091 713',
      shipping_country: 'AU',
      order_date: '2026-07-16T00:00:00.000Z',
      order_value: 34997,
      shipping_amount: 2999,
      currency: 'INR'
    },
    items: [{
      product_name: 'RE Himalayan 450 - Cruise Control Kit',
      hsn_code: '90328910',
      quantity: 2,
      item_price: 15999,
      total_price: 31998
    }]
  }, { format: 'international-label' }).toString('latin1');

  assert.match(pdf, /Qty 2/);
  assert.match(pdf, /Phone  \+61479091713/);
  assert.match(pdf, /Tel: \+918904137604/);
  assert.match(pdf, /Unit price  INR 15999\.00/);
});

test('omits AWB row when no order or shipment AWB exists', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-no-awb',
      order_number: '10406',
      customer_name: 'Buyer',
      shipping_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 1180,
      currency: 'INR'
    },
    items: [{
      product_name: 'HMT Cruise Kit',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 1180,
      total_price: 1180
    }]
  }).toString('latin1');

  assert.doesNotMatch(pdf, /AWB:/);
  assert.match(pdf, /Buyer Tax ID: -/);
});

test('uses Wix raw order VAT ID as buyer tax fallback', () => {
  const model = buildInvoiceModel({
    order: {
      id: 'order-vat',
      order_number: '10407',
      customer_name: 'VAT Buyer',
      shipping_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 1180,
      currency: 'INR',
      raw_order: {
        billingInfo: {
          contactDetails: {
            vatId: { id: '36AAKCV4790K1ZM', type: 'GSTIN' }
          }
        }
      }
    },
    items: [{
      product_name: 'HMT Cruise Kit',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 1180,
      total_price: 1180
    }]
  });

  assert.equal(model.buyer.gstin, '36AAKCV4790K1ZM');
  assert.equal(model.buyer.gstType, 'GSTIN');
});

test('wraps long product names instead of truncating them', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-5',
      order_number: '10404',
      customer_name: 'Buyer',
      shipping_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 14499,
      currency: 'INR'
    },
    items: [{
      product_name: 'RE Guerrilla 450 - Hold My Throttle Long Product Name',
      hsn_code: '90328910',
      quantity: 1,
      item_price: 14499,
      total_price: 14499
    }]
  }).toString('latin1');

  assert.match(pdf, /RE Guerrilla 450 - Hold My Throttle/);
  assert.match(pdf, /Long/);
  assert.match(pdf, /Product Name/);
  assert.doesNotMatch(pdf, /RE Guerrilla 450 - Hold My \.\.\./);
});

test('renders buyer GST and both address sections even when fields are incomplete', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-4',
      order_number: '10403',
      customer_name: 'GST Buyer',
      buyer_gst: '29GSTBUYER1Z5',
      buyer_gst_type: 'GSTIN',
      phone: '9999999999',
      shipping_name: 'Ship Customer',
      shipping_address_line1: '12 Shipping Road',
      shipping_city: 'Bengaluru',
      shipping_state: 'KA',
      shipping_pincode: '560102',
      shipping_country: 'IN',
      billing_name: 'Bill Customer',
      billing_country: 'IN',
      order_date: '2026-06-12T08:00:00.000Z',
      payment_status: 'PAID',
      order_value: 1180,
      currency: 'INR'
    },
    items: [{
      product_name: 'HMT Cruise Kit',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 1180,
      total_price: 1180
    }]
  }).toString('latin1');

  assert.match(pdf, /Buyer Tax ID: 29GSTBUYER1Z5 \\\(GSTIN\\\)/);
  assert.match(pdf, /Billing To:/);
  assert.match(pdf, /Ship To:/);
  assert.match(pdf, /Bill Customer/);
  assert.match(pdf, /Address not provided/);
  assert.match(pdf, /Ship Customer/);
  assert.match(pdf, /12 Shipping Road/);
});

test('renders a readable 10x15 international invoice with a side-by-side reference header', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-international-label',
      order_number: '10408',
      customer_name: 'Export Buyer',
      shipping_name: 'Export Buyer',
      shipping_address_line1: '15 Shipping Road',
      shipping_city: 'Oslo',
      shipping_country: 'Norway',
      order_date: '2026-06-12T08:00:00.000Z',
      order_value: 100,
      currency: 'USD'
    },
    items: [{
      product_name: 'HMT Cruise Kit',
      hsn_code: '87141090',
      quantity: 1,
      item_price: 100,
      total_price: 100
    }]
  }, { format: 'international-label' }).toString('latin1');

  assert.match(pdf, /\/MediaBox \[0 0 283\.465 425\.197\]/);
  assert.match(pdf, /TAX INVOICE/);
  assert.match(pdf, /\(INVOICE\) Tj/);
  assert.match(pdf, /\(10408\) Tj/);
  assert.match(pdf, /CONSIGNEE \/ SHIP TO/);
  assert.match(pdf, /TOTAL TO DECLARE/);
  assert.match(pdf, /EXPORTER & EXPORT DETAILS/);
  assert.match(pdf, /Place of supply India/);
  // Thermal labels need bold hierarchy; ensure Helvetica-Bold is used.
  assert.match(pdf, /\/F2 [\d.]+ Tf/);
  // Avoid pale/blue fills that wash out on monochrome thermal printers.
  assert.doesNotMatch(pdf, /0\.02 0\.24 0\.45 rg/);
  assert.doesNotMatch(pdf, /0\.94 0\.97 0\.99 rg/);
});

test('10x15 invoice shows the main product instead of a mirror mount accessory', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-main-plus-mount',
      order_number: '10409',
      customer_name: 'Export Buyer',
      shipping_country: 'Norway',
      order_date: '2026-07-23T08:00:00.000Z',
      order_value: 16198,
      currency: 'INR'
    },
    items: [
      {
        product_name: 'RE Himalayan 450 Cruise Control Kit',
        hsn_code: '90328910',
        quantity: 1,
        item_price: 15999,
        total_price: 15999
      },
      {
        product_name: 'Hold My Throttle Mirror Mount',
        hsn_code: '87141090',
        quantity: 1,
        item_price: 199,
        total_price: 199
      }
    ]
  }, { format: 'international-label' }).toString('latin1');

  assert.match(pdf, /RE Himalayan 450 Cruise Control Kit/);
  assert.doesNotMatch(pdf, /Hold My Throttle Mirror Mount/);
});

test('10x15 invoice shows the highest-value item when the order contains only accessories', () => {
  const pdf = buildInvoicePdf({
    order: {
      id: 'order-accessories-only',
      order_number: '10410',
      customer_name: 'Export Buyer',
      shipping_country: 'Norway',
      order_date: '2026-07-23T08:00:00.000Z',
      order_value: 698,
      currency: 'INR'
    },
    items: [
      {
        product_name: 'Mirror Mount Accessory',
        hsn_code: '87141090',
        quantity: 1,
        item_price: 199,
        total_price: 199
      },
      {
        product_name: 'Handlebar Accessory',
        hsn_code: '87141090',
        quantity: 1,
        item_price: 499,
        total_price: 499
      }
    ]
  }, { format: 'international-label' }).toString('latin1');

  assert.match(pdf, /Handlebar Accessory/);
  assert.doesNotMatch(pdf, /Mirror Mount Accessory/);
});
