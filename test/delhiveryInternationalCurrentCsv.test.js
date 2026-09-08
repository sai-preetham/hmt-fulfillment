import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DELHIVERY_CURRENT_TEMPLATE_PROFILES,
  buildDelhiveryInternationalCurrentCsv,
  getDelhiveryCurrentTemplateProfile
} from '../src/delhiveryInternationalCurrentCsv.js';

const order = {
  order_number: 'WIX-1001',
  total_amount: 125,
  package_weight_grams: 500,
  source_created_at: '2026-07-22T10:00:00.000Z',
  customers: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+14155550100' },
  raw_order: {
    lineItems: [{ quantity: 1, productName: { original: 'Motorcycle throttle' }, price: { amount: '125' }, physicalProperties: { sku: 'HMT-1', weight: 0.5 } }],
    shippingInfo: { logistics: { shippingDestination: { address: { addressLine: '1 Market St', addressLine2: 'Suite 2', city: 'San Francisco', subdivision: 'CA', postalCode: '94105' }, contactDetails: { firstName: 'Ada', lastName: 'Lovelace', phone: '+14155550100' } } } }
  }
};

const config = {
  delhivery: {
    pickupLocation: 'HSR BYKR',
    international: {
      clientName: 'BYKR TECH PVT LTD',
      pickupWarehouseId: 'BYKR_HSR',
      lengthCm: 24,
      widthCm: 15,
      heightCm: 8,
      hsnCode: '87141090',
      ewbn: '181000001387',
      igstRate: 18,
      shipper: { name: 'BYKR TECH PVT LTD', phone: '+918000000000', address: 'HSR Layout', city: 'Bengaluru', state: 'Karnataka', pincode: '560102', iec: 'ABCDE1234F', gstin: '29ABCDE1234F1Z5', pan: 'ABCDE1234F', bankAdCode: '1234567', bankIfsc: 'HDFC0000001', bankAccountNumber: '1234567890' }
    }
  }
};

test('uses the current portal headers for DLV Saver US and DLV Premium', () => {
  const saver = buildDelhiveryInternationalCurrentCsv([order], config, { service: 'saver', country: 'US' });
  const premium = buildDelhiveryInternationalCurrentCsv([order], config, { service: 'premium', country: 'US' });

  assert.equal(saver.profile.headers.length, 50);
  assert.equal(saver.csv.split('\r\n')[0].split(',')[0], 'Order No');
  assert.match(saver.csv, /WIX-1001,HSR BYKR,US,FOB/);
  assert.equal(premium.profile.headers.length, 83);
  assert.match(premium.csv, /order_no\*\^/);
  assert.match(premium.csv, /EXPORTS_EXPRESS,commercial/);
  assert.equal(premium.issues.filter(issue => issue.level === 'error').length, 0);
});

test('uses the separately downloaded Germany Saver variant without Street Address 2', () => {
  const profile = getDelhiveryCurrentTemplateProfile({ service: 'DLV Saver', country: 'Germany' });
  const result = buildDelhiveryInternationalCurrentCsv([order], config, { service: 'saver', country: 'DE' });

  assert.equal(profile.headers.length, 49);
  assert.equal(profile.headers.includes('Street Address 2'), false);
  assert.equal(result.csv.split('\r\n')[0].split(',').includes('Street Address 2'), false);
  assert.match(result.csv, /WIX-1001,HSR BYKR,DE,FOB/);
});

test('keeps a fresh-profile provenance marker and reports missing CSB V commercial inputs', () => {
  assert.match(DELHIVERY_CURRENT_TEMPLATE_PROFILES.premium.downloadedFrom, /2026-07-23/);
  const result = buildDelhiveryInternationalCurrentCsv([order], { delhivery: { international: {} } }, { service: 'premium', country: 'AU' });

  assert.ok(result.issues.some(issue => issue.field === 'client_name*^'));
  assert.ok(result.issues.some(issue => issue.field === 'pickup_warehouse_ID*^'));
  assert.equal(result.issues.some(issue => issue.field === 'EWBN'), false);
});

test('uses the freshly downloaded Sweden Premium profile and shipment-level goods value', () => {
  const multiItemOrder = {
    ...order,
    raw_order: { ...order.raw_order, lineItems: [
      { quantity: 1, productName: { original: 'Cruise control kit' }, price: { amount: '15999' }, physicalProperties: { sku: 'HMT-REH450-1', weight: 0.4 } },
      { quantity: 2, productName: { original: 'Mirror switch mount' }, price: { amount: '199' }, physicalProperties: { sku: 'HMT-MM1', weight: 0.05 } }
    ] }
  };
  const result = buildDelhiveryInternationalCurrentCsv([multiItemOrder], config, { service: 'DLV Premium', country: 'Sweden' });

  assert.equal(result.profile.country, 'SE');
  assert.equal(result.csv.split('\r\n')[0].split(',')[0], 'waybill');
  assert.match(result.csv, /WIX-1001,BYKR TECH PVT LTD,500/);
  assert.match(result.csv, /ada@example\.com,14155550100,/);
  assert.match(result.csv, /Cruise control kit; Mirror switch mount/);
  assert.match(result.csv, /16397/);
  assert.match(result.csv, /WIX-1001,2026-07-22,INR,FOB/);
  assert.doesNotMatch(result.csv, /[^\x00-\x7F]/);
  assert.match(result.csv, /courier,,1,,,181000001387,1,500/);
});

test('requires an IGST rate for Paid commercial Premium shipments', () => {
  const result = buildDelhiveryInternationalCurrentCsv([order], {
    delhivery: { international: { ...config.delhivery.international, igstRate: '' } }
  }, { service: 'premium', country: 'SE' });

  assert.ok(result.issues.some(issue => issue.field === 'igst_rate'));
});
