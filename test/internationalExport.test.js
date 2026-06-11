import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInternationalShipmentRow,
  buildInternationalShipmentWorkbook,
  INTERNATIONAL_EXPORT_HEADERS,
  internationalExportFilename
} from '../src/internationalExport.js';

test('builds international shipment export row from Wix order data', () => {
  const row = buildInternationalShipmentRow(sampleInternationalOrder(), sampleConfig());

  assert.equal(row['Order No'], '2001');
  assert.equal(row['Pickup Facility Name'], 'HMT Pickup');
  assert.equal(row['Consignee Name'], 'Ada Lovelace');
  assert.equal(row['Consignee State/Province Code'], 'CA');
  assert.equal(row['Consignee Pincode'], '94105');
  assert.equal(row['Box Weight (Kg)'], 0.5);
  assert.equal(row['Product Description'], 'Hold My Throttle');
  assert.equal(row.SKUs, 'HMT-SKU');
  assert.equal(row.Quantity, 1);
  assert.equal(row['Unit Price'], 129);
  assert.equal(row['Purpose of Booking'], 'Gift');
  assert.equal(row['Terms of Invoice (Inco Terms)'], 'FOB');
  assert.equal(row.Reference, 'Wix 2001');
});

test('collapses extra accessories into one Hold My Throttle export item', () => {
  const order = sampleInternationalOrder();
  order.raw_order.lineItems.push({
    productName: { original: 'Mirror Mount Accessory' },
    quantity: 3,
    price: { amount: '10' },
    physicalProperties: { sku: 'ACCESSORY-SKU', weight: 0.1 }
  });

  const row = buildInternationalShipmentRow(order, sampleConfig());

  assert.equal(row['Product Description'], 'Hold My Throttle');
  assert.equal(row.SKUs, 'HMT-SKU');
  assert.equal(row.Quantity, 1);
  assert.equal(row['Unit Price'], 129);
});

test('includes all Delhivery DLV Saver CSB4 upload headers from the sample', () => {
  assert.deepEqual(INTERNATIONAL_EXPORT_HEADERS, [
    'Order No',
    'Pickup Facility Name',
    'Consignee Name',
    'Street Address 1',
    'Street Address 2',
    'Consignee City',
    'Consignee State/Province Code',
    'Consignee Pincode',
    'Consignee Phone',
    'Consignee Email',
    'VAT Number',
    'IOSS Number',
    'Invoice No',
    'Invoice Date (YYYY-MM-DD)',
    'Purpose of Booking',
    'Terms of Invoice (Inco Terms)',
    'Currency',
    'Box Number',
    'Length (cm)',
    'Breadth (cm)',
    'Height (cm)',
    'Box Weight (Kg)',
    'Product Category',
    'Product Description',
    'Quantity',
    'Unit Price',
    'Product Amount',
    'Item Unit Weight Kg',
    'HSN Code',
    'HTS Code',
    'Product ID'
  ]);
});

test('builds Excel-compatible workbook for international shipment upload', () => {
  const workbook = buildInternationalShipmentWorkbook([sampleInternationalOrder()], sampleConfig());
  const workbookText = workbook.toString('utf8');

  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
  assert.match(workbookText, /\[Content_Types\]\.xml/);
  assert.match(workbookText, /xl\/worksheets\/sheet1\.xml/);
  assert.match(workbookText, /Sample Sheet/);
  assert.match(workbookText, /Order No/);
  assert.match(workbookText, /Ada Lovelace/);
  assert.match(workbookText, /Hold My Throttle/);
  assert.match(workbookText, /HMT-SKU/);
  assert.doesNotMatch(workbookText, /order_no\*\^/);
  assert.notEqual(workbook.subarray(0, 5).toString('utf8'), '<?xml');
});

test('uses xlsx extension for international export filenames', () => {
  assert.equal(internationalExportFilename([sampleInternationalOrder()]), 'international-shipment-2001.xlsx');
});

function sampleInternationalOrder() {
  return {
    id: 'db-order-id',
    wix_order_id: 'wix-order-id',
    order_number: '2001',
    payment_status: 'PAID',
    currency: 'USD',
    total_amount: 129,
    shipping_amount: 19,
    selected_shipping_title: 'International Express',
    customers: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '+14155550100'
    },
    raw_order: {
      id: 'wix-order-id',
      number: '2001',
      currency: 'USD',
      buyerInfo: {
        email: 'ada@example.com'
      },
      shippingInfo: {
        title: 'International Express',
        logistics: {
          shippingDestination: {
            address: {
              addressLine: '1 Market St',
              city: 'San Francisco',
              subdivision: 'CA',
              postalCode: '94105',
              country: 'US'
            },
            contactDetails: {
              firstName: 'Ada',
              lastName: 'Lovelace',
              phone: '+14155550100'
            }
          }
        }
      },
      lineItems: [
        {
          productName: { original: 'Hold My Throttle' },
          quantity: 1,
          price: { amount: '110' },
          physicalProperties: { sku: 'HMT-SKU', weight: 0.4 }
        }
      ]
    }
  };
}

function sampleConfig() {
  return {
    defaults: {
      hsnCode: '87141090',
      weightGrams: 500,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      internationalShipmentType: 'Commercial',
      paymentMode: 'Prepaid'
    },
    delhivery: {
      clientName: 'Delhivery Client',
      pickupLocation: 'HMT Pickup',
      pickupPincode: '110001',
      returnName: 'HMT Warehouse',
      returnAddress: 'Warehouse Road',
      returnCity: 'New Delhi',
      returnState: 'Delhi',
      returnPincode: '110001',
      returnPhone: '+919999999999'
    }
  };
}
