const baseUrl = process.env.CRM_BASE_URL || 'http://localhost:3000';
const paidStatuses = new Set(['PAID', 'APPROVED', 'paid', 'approved']);
const failures = [];

const checks = [
  ['packing', '/api/crm/orders?status=awaiting_packing&limit=100'],
  ['not_paid', '/api/crm/orders?status=not_paid&limit=25'],
  ['cancelled', '/api/crm/orders?status=cancelled&limit=25'],
  ['fulfilled_no_tracking', '/api/crm/orders?status=fulfilled_no_tracking&limit=25'],
  ['search_10091', '/api/crm/orders?q=10091&limit=5'],
  ['search_10355', '/api/crm/orders?q=10355&limit=5']
];

const results = {};
for (const [name, path] of checks) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    failures.push(`${name}: HTTP ${response.status}`);
    continue;
  }
  const payload = await response.json();
  results[name] = payload.orders || [];
}

assertAll(
  'packing has only paid active orders',
  (results.packing || []).every(order => paidStatuses.has(order.payment_status) && order.internal_status === 'awaiting_packing')
);

assertAll(
  'not_paid filter has only not_paid statuses',
  (results.not_paid || []).every(order => order.internal_status === 'not_paid' && !paidStatuses.has(order.payment_status))
);

assertAll(
  'cancelled filter has only cancelled statuses',
  (results.cancelled || []).every(order => order.internal_status === 'cancelled')
);

assertAll(
  'fulfilled_no_tracking filter has only paid fulfilled-without-tracking orders',
  (results.fulfilled_no_tracking || []).every(order => paidStatuses.has(order.payment_status) && order.internal_status === 'fulfilled_no_tracking' && !order.awb_number)
);

const order10091 = (results.search_10091 || []).find(order => order.order_number === '10091');
assertAll('10091 is real production order, not seed data', order10091 && order10091.customer_name !== 'Arjun Mehta' && order10091.awb_number === '7X111004357');

const order10355 = (results.search_10355 || []).find(order => order.order_number === '10355');
assertAll('10355 has valid carrier tracking from Wix fulfillment', order10355 && order10355.courier === 'usps' && order10355.tracking_url.includes('usps.com'));

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  counts: Object.fromEntries(Object.entries(results).map(([key, rows]) => [key, rows.length])),
  samples: {
    packing: (results.packing || []).slice(0, 3).map(summarize),
    not_paid: (results.not_paid || []).slice(0, 3).map(summarize),
    cancelled: (results.cancelled || []).slice(0, 3).map(summarize),
    fulfilled_no_tracking: (results.fulfilled_no_tracking || []).slice(0, 3).map(summarize),
    order10091: summarize(order10091),
    order10355: summarize(order10355)
  }
}, null, 2));

function assertAll(label, condition) {
  if (!condition) failures.push(label);
}

function summarize(order) {
  if (!order) return null;
  return {
    order: order.order_number,
    customer: order.customer_name,
    payment: order.payment_status,
    internal: order.internal_status,
    shipment: order.shipment_status,
    courier: order.courier,
    awb: order.awb_number,
    tracking: order.tracking_url
  };
}
