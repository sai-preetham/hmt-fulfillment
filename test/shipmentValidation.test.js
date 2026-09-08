import assert from 'node:assert/strict';
import test from 'node:test';
import { validateShipmentPayload } from '../src/shipmentValidation.js';

test('manual AWB saving only requires an AWB, not courier-booking address fields', () => {
  assert.deepEqual(
    validateShipmentPayload({ awb_number: 'MANUAL-AWB-123', country: 'IN' }, { manualAwb: true }),
    []
  );
});

test('manual AWB saving gives an actionable error when the AWB is absent', () => {
  assert.deepEqual(
    validateShipmentPayload({}, { manualAwb: true }),
    ['AWB is required to save a manual shipment']
  );
});

test('courier booking still validates delivery details', () => {
  assert.ok(validateShipmentPayload({ country: 'IN' }).includes('Invalid pincode'));
});
