import assert from 'node:assert/strict';
import test from 'node:test';
import { createShipmentLabel } from '../src/labels.js';

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
