import assert from 'node:assert/strict';
import test from 'node:test';
import { createShipmentLabel } from '../src/labels.js';
import { buildDelhiveryShippingLabelPdf } from '../lib/crm/shipping-label-pdf.js';

test('renders the AWB as a vector Code 128 barcode rather than a carrier image', () => {
  const pdf = buildDelhiveryShippingLabelPdf({
    packages: [{ wbn: '52270010000840', oid: '10541', name: 'Swati Rojha', address: 'Delhi', pin: '110041' }]
  }).toString('latin1');

  assert.match(pdf, /52270010000840/);
  assert.doesNotMatch(pdf, /\/Subtype \/Image/);
  assert.match(pdf, / re f/);
});

test('uses compact Code 128 set C for even-length numeric AWBs', () => {
  const pdf = buildDelhiveryShippingLabelPdf({ packages: [{ wbn: '52270010000840' }] }).toString('latin1');
  const barCount = (pdf.match(/ re f/g) || []).length;

  // Set C has seven data symbols for this 14-digit AWB, so it needs far fewer
  // vector bars than the one-character-per-symbol Code 128 set B encoding.
  assert.ok(barCount < 40, `expected a compact barcode, received ${barCount} bars`);
});

test('creates shipment label metadata from configured Delhivery label endpoint', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return {
      ok: true,
      text: async () => JSON.stringify({ label_url: 'https://labels.example/awb-1.pdf' })
    };
  };

  try {
    const label = await createShipmentLabel({ waybill: 'awb-1' }, config());

    assert.equal(label.label_url, 'https://labels.example/awb-1.pdf');
    assert.equal(label.label_format, 'pdf');
    assert.equal(request.url, 'https://labels.example/create?waybill=awb-1');
    assert.equal(request.options.headers.Authorization, 'Token token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('label generation requires a configured endpoint', async () => {
  await assert.rejects(
    () => createShipmentLabel({ waybill: 'awb-1' }, { delhivery: { token: 'token', labelUrl: '' } }),
    /DELHIVERY_LABEL_URL/
  );
});

function config() {
  return {
    delhivery: {
      token: 'token',
      labelUrl: 'https://labels.example/create'
    }
  };
}
