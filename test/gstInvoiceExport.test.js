import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGstInvoiceRow, dateRangeBounds, gstInvoiceCsv, monthBounds, shouldIncludeGstInvoice, summarizeGstInvoices } from '../lib/crm/gst-invoice-export.js';

test('exports valid domestic B2B GSTIN and uses the stored GST amount', () => {
  const row = buildGstInvoiceRow({
    order_number: '10407', source_created_at: '2026-06-29T10:00:00.000Z', tax_amount: 2362.43, total_amount: 15487.03, currency: 'INR',
    customers: { tax_id: '19GMSPM3198B1ZG' }, shipping_address: { country: 'IND' }, billing_address: { country: 'IND' }
  });
  assert.equal(row.gst, '19GMSPM3198B1ZG');
  assert.equal(row.totalTax, 2362.43);
  assert.equal(row.taxableValue, 13124.6);
  assert.equal(row.gstTreatment, 'B2B');
});

test('marks international invoices as LUT exports with no GST', () => {
  const row = buildGstInvoiceRow({
    order_number: '10406', source_created_at: '2026-06-29T10:00:00.000Z', tax_amount: 999, total_amount: 21998, currency: 'INR',
    customers: { tax_id: '19GMSPM3198B1ZG' }, shipping_address: { country: 'FRA' }, billing_address: { country: 'FRA' }
  });
  assert.equal(row.gst, '');
  assert.equal(row.totalTax, 0);
  assert.equal(row.gstTreatment, 'LUT');
});

test('calculates inclusive 18 percent GST only when a domestic order lacks a stored tax amount', () => {
  const row = buildGstInvoiceRow({ total_amount: 1180, shipping_address: { country: 'IN' } });
  assert.equal(row.totalTax, 180);
});

test('includes only paid or approved orders that are not cancelled', () => {
  assert.equal(shouldIncludeGstInvoice({ payment_status: 'paid', status: 'completed' }), true);
  assert.equal(shouldIncludeGstInvoice({ payment_status: 'approved', status: 'processing' }), true);
  assert.equal(shouldIncludeGstInvoice({ payment_status: 'partially_refunded', status: 'approved' }), true);
  assert.equal(shouldIncludeGstInvoice({ payment_status: 'pending', status: 'completed' }), false);
  assert.equal(shouldIncludeGstInvoice({ payment_status: 'paid', status: 'cancelled' }), false);
});

test('uses the net retained amount for a partially refunded order', () => {
  const row = buildGstInvoiceRow({
    payment_status: 'partially_refunded', total_amount: 15198, tax_amount: 2318.34,
    payment_refs: { paid_amount: 15679.66, refunded_amount: 481 }, shipping_address: { country: 'IN' }
  });
  assert.equal(row.total, 15198.66);
  assert.equal(row.totalTax, 2318.34);
  assert.equal(row.gstTreatment, 'B2C');
});

test('uses B2C for invoices with no recorded destination', () => {
  const row = buildGstInvoiceRow({ total_amount: 1180 });
  assert.equal(row.gstTreatment, 'B2C');
});

test('formats a CSV with the agreed sales and GST report columns', () => {
  const csv = gstInvoiceCsv([buildGstInvoiceRow({ order_number: '10407', total_amount: 1180, shipping_address: { country: 'IND' } })]);
  assert.match(csv, /^Order #,Order date,Customer,Delivery country,GSTIN,GST type,GST treatment,Value without tax,GST,Total with tax,Currency,Payment status\r\n/);
  assert.match(csv, /B2C/);
  assert.deepEqual(monthBounds('2026-06'), { start: '2026-05-31T18:30:00.000Z', end: '2026-06-30T18:30:00.000Z' });
});

test('uses inclusive India-time date ranges and rejects invalid ranges', () => {
  assert.deepEqual(dateRangeBounds('2026-08-01', '2026-08-31'), { start: '2026-07-31T18:30:00.000Z', end: '2026-08-31T18:30:00.000Z' });
  assert.throws(() => dateRangeBounds('2026-09-01', '2026-08-31'), /on or before/);
  assert.throws(() => dateRangeBounds('2025-01-01', '2026-12-31'), /366 days/);
});

test('summarizes taxable value, GST, totals, treatments, and reconciliation', () => {
  const report = summarizeGstInvoices([
    { taxableValue: 1000, totalTax: 180, total: 1180, gstTreatment: 'B2C' },
    { taxableValue: 500, totalTax: 0, total: 500, gstTreatment: 'LUT' }
  ]);
  assert.deepEqual(report, {
    orders: 2, taxableValue: 1500, totalTax: 180, total: 1680, difference: 0,
    treatments: { B2C: { orders: 1, total: 1180 }, LUT: { orders: 1, total: 500 } }
  });
});
