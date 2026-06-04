import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInternationalShipmentRow, buildInternationalShipmentWorkbook } from '../src/internationalExport.js';

test('builds international shipment export row from Wix order data', () => {
  const row = buildInternationalShipmentRow(sampleInternationalOrder(), sampleConfig());

  assert.equal(row['Order Number'], '2001');
  assert.equal(row.Service, 'Deferred Express');
  assert.equal(row['Customer Name'], 'Ada Lovelace');
  assert.equal(row.Country, 'US');
  assert.equal(row['Postal Code'], '94105');
  assert.equal(row['Weight Grams'], 500);
  assert.equal(row.SKUs, 'SKU-A');
  assert.equal(row.Reference, 'Wix 2001');
});

test('builds Excel-compatible workbook for international shipment upload', () => {
  const workbook = buildInternationalShipmentWorkbook([sampleInternationalOrder()], sampleConfig()).toString('utf8');

  assert.match(workbook, /<Workbook/);
  assert.match(workbook, /International Shipments/);
  assert.match(workbook, /Order Number/);
  assert.match(workbook, /Ada Lovelace/);
  assert.match(workbook, /SKU-A/);
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
          productName: { original: 'Motorcycle Part' },
          quantity: 1,
          price: { amount: '110' },
          physicalProperties: { sku: 'SKU-A', weight: 0.4 }
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
      internationalShipmentType: 'Commercial'
    }
  };
}
