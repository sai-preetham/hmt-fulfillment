import test from 'node:test';
import assert from 'node:assert/strict';
import { bankFingerprint, bomRequirements, documentTotals, isBalanced, weightedAverage } from '../lib/finance/calculations.js';
import { buildCaPack, csv } from '../lib/finance/exports.js';

test('calculates invoice totals in base currency', () => {
  assert.deepEqual(documentTotals([{ quantity: 2, unit_price: 100, tax_rate: 18 }], 1.5, 10), { subtotal: 200, tax_amount: 36, tds_amount: 10, total_amount: 226, base_total_amount: 339 });
});

test('accepts only balanced journals', () => {
  assert.equal(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }]), true);
  assert.equal(isBalanced([{ debit: 100, credit: 0 }]), false);
});

test('creates BOM material requirements with scrap', () => {
  assert.equal(bomRequirements([{ quantity: 2, scrap_percent: 5 }], 10, 2)[0].required_quantity, 10.5);
});

test('maintains weighted average inventory cost', () => {
  assert.equal(weightedAverage({ currentQuantity: 10, currentCost: 50, receivedQuantity: 10, receivedUnitCost: 70 }), 60);
});

test('bank fingerprints normalize equivalent source rows', () => {
  assert.equal(bankFingerprint({ transaction_date: '2026-08-01', description: 'UPI   RECEIPT ', credit: 100 }), bankFingerprint({ transaction_date: '2026-08-01', description: 'upi receipt', credit: 100 }));
});

test('creates CA-ready CSV sections', () => {
  const pack = buildCaPack({ documents: [{ document_type: 'sales_invoice', document_number: 'INV-1', document_date: '2026-08-01', currency: 'INR', subtotal: 100, tax_amount: 18, total_amount: 118, status: 'approved' }], dashboard: { revenue: 118 } });
  assert.match(csv(pack.sales), /INV-1/);
  assert.match(csv(pack.pnl), /Revenue,118/);
});
