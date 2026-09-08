import { createServiceClient } from '../supabase/server.js';

const HEADER = ['Invoice number', 'Date created', 'GST', 'Delivery country', 'Billing country', 'Total tax', 'Total', 'Currency', 'GST treatment'];

export async function listGstInvoiceRows(month) {
  const bounds = monthBounds(month);
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, order_number, external_order_id, status, payment_status, tax_amount, total_amount, currency, source_created_at,
      payment_refs(paid_amount,refunded_amount),
      customers(tax_id,tax_id_type),
      shipping_address:customer_addresses!orders_shipping_address_id_fkey(country),
      billing_address:customer_addresses!orders_billing_address_id_fkey(country)
    `)
    .gte('source_created_at', bounds.start)
    .lt('source_created_at', bounds.end)
    .order('source_created_at', { ascending: false })
    .limit(5000);

  if (error) throw new Error(`Could not load monthly invoices: ${error.message}`);
  return (data || []).filter(shouldIncludeGstInvoice).map(buildGstInvoiceRow);
}

export function buildGstInvoiceRow(order = {}) {
  const deliveryCountry = text(order.shipping_address?.country);
  const billingCountry = text(order.billing_address?.country);
  const destinationCountry = deliveryCountry || billingCountry;
  const international = Boolean(destinationCountry) && !isIndia(destinationCountry);
  const total = netRetainedAmount(order);
  const totalTax = international ? 0 : taxAmount(order.tax_amount, total);
  const taxId = text(order.customers?.tax_id);
  const gstin = !international && isGstin(taxId) ? taxId.toUpperCase() : '';

  return {
    invoiceNumber: text(order.order_number || order.external_order_id || order.id),
    dateCreated: formatDate(order.source_created_at),
    gst: gstin,
    deliveryCountry,
    billingCountry,
    totalTax,
    total,
    currency: text(order.currency || 'INR'),
    gstTreatment: international ? 'LUT' : gstin ? 'B2B' : 'B2C'
  };
}

export function gstInvoiceCsv(rows = []) {
  const values = rows.map(row => [row.invoiceNumber, row.dateCreated, row.gst, row.deliveryCountry, row.billingCountry, row.totalTax, row.total, row.currency, row.gstTreatment]);
  return [HEADER, ...values].map(row => row.map(csvValue).join(',')).join('\r\n');
}

export function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('month must use YYYY-MM.');
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month must use YYYY-MM.');
  // GST periods are interpreted in India time. India has a fixed UTC+05:30 offset.
  const istOffset = 5.5 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(year, monthNumber - 1, 1) - istOffset);
  const end = new Date(Date.UTC(year, monthNumber, 1) - istOffset);
  return { start: start.toISOString(), end: end.toISOString() };
}

function taxAmount(storedTax, total) {
  const tax = amount(storedTax);
  return tax > 0 ? tax : round(total * 18 / 118);
}

function isIndia(country) {
  return ['IN', 'IND', 'INDIA'].includes(text(country).toUpperCase());
}

function isGstin(value) {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(value.toUpperCase());
}

function isCancelled(order) {
  return ['cancelled', 'canceled'].includes(text(order.status).toLowerCase());
}

export function shouldIncludeGstInvoice(order) {
  return !isCancelled(order) && ['paid', 'approved', 'partially_refunded'].includes(text(order.payment_status).toLowerCase());
}

function netRetainedAmount(order) {
  if (!isPartiallyRefunded(order)) return amount(order.total_amount);
  const payment = order.payment_refs || {};
  const paid = amount(payment.paid_amount);
  const refunded = amount(payment.refunded_amount);
  return paid > 0 ? round(paid - refunded) : amount(order.total_amount);
}

function isPartiallyRefunded(order) {
  return text(order.payment_status).toLowerCase() === 'partially_refunded';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata' }).format(date).replace(/ /g, '-');
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? round(number) : 0;
}

function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function text(value) { return String(value || '').trim(); }
function csvValue(value) {
  const string = String(value ?? '');
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}
