import { readFileSync } from 'node:fs';
import {
  BOOKING_COURIERS,
  COURIERS,
  FEEDBACK_STATUSES,
  INSTALLATION_METHODS,
  INSTALLATION_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SHIPMENT_STATUSES,
  STATUS_FILTERS
} from '../lib/crm/constants.js';

const baseUrl = process.env.CRM_BASE_URL || 'http://127.0.0.1:3000';
const failures = [];

checkUnique('ORDER_STATUSES', ORDER_STATUSES);
checkUnique('SHIPMENT_STATUSES', SHIPMENT_STATUSES);
checkUnique('INSTALLATION_STATUSES', INSTALLATION_STATUSES);
checkUnique('INSTALLATION_METHODS', INSTALLATION_METHODS);
checkUnique('FEEDBACK_STATUSES', FEEDBACK_STATUSES);
checkUnique('COURIERS', COURIERS);
checkUnique('PAYMENT_STATUSES', PAYMENT_STATUSES);

const filterValues = STATUS_FILTERS.map(([value]) => value);
const missingFilters = ORDER_STATUSES.filter(status => !filterValues.includes(status));
if (missingFilters.length) failures.push(`STATUS_FILTERS missing order statuses: ${missingFilters.join(', ')}`);

for (const courier of BOOKING_COURIERS) {
  if (!COURIERS.includes(courier.code)) failures.push(`BOOKING_COURIERS contains ${courier.code}, but COURIERS does not.`);
  if (!courier.services?.length) failures.push(`BOOKING_COURIERS ${courier.code} has no services.`);
}

const orderDetailForm = readFileSync('components/order-detail-form.jsx', 'utf8');
[
  'ORDER_STATUSES',
  'SHIPMENT_STATUSES',
  'INSTALLATION_STATUSES',
  'INSTALLATION_METHODS',
  'FEEDBACK_STATUSES',
  'PAYMENT_STATUSES',
  'COURIERS'
].forEach(name => {
  if (!orderDetailForm.includes(name)) failures.push(`Order detail form does not use ${name}.`);
});

const shipmentForm = readFileSync('components/shipment-form.jsx', 'utf8');
if (!shipmentForm.includes('BOOKING_COURIERS')) failures.push('Shipment form does not use BOOKING_COURIERS.');
if (!shipmentForm.includes('Save manual AWB')) failures.push('Shipment form is missing manual AWB action.');
if (!shipmentForm.includes('Book courier')) failures.push('Shipment form is missing courier booking action.');
if (!shipmentForm.includes('Generate label')) failures.push('Shipment form is missing label generation action.');

const orderFilters = readFileSync('components/order-table.jsx', 'utf8');
if (!orderFilters.includes('STATUS_FILTERS')) failures.push('Order table filters do not use STATUS_FILTERS.');

const apiChecks = [];
for (const status of ORDER_STATUSES) {
  apiChecks.push(checkApi(`status:${status}`, `/api/crm/orders?status=${encodeURIComponent(status)}&limit=1`));
}
apiChecks.push(checkApi('orders page', '/orders?status=details_verified'));
apiChecks.push(checkApi('settings page', '/settings'));

await Promise.all(apiChecks);

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      counts: {
        orderStatuses: ORDER_STATUSES.length,
        shipmentStatuses: SHIPMENT_STATUSES.length,
        installationStatuses: INSTALLATION_STATUSES.length,
        installationMethods: INSTALLATION_METHODS.length,
        feedbackStatuses: FEEDBACK_STATUSES.length,
        couriers: COURIERS.length,
        paymentStatuses: PAYMENT_STATUSES.length,
        bookingCouriers: BOOKING_COURIERS.length,
        bookingServices: BOOKING_COURIERS.reduce((sum, courier) => sum + courier.services.length, 0)
      },
      filters: STATUS_FILTERS.map(([value]) => value)
    },
    null,
    2
  )
);

function checkUnique(name, values) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) failures.push(`${name} has duplicates: ${[...new Set(duplicates)].join(', ')}`);
}

async function checkApi(name, path) {
  try {
    const response = await fetch(`${baseUrl}${path}`);
    if (!response.ok) failures.push(`${name}: HTTP ${response.status}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
