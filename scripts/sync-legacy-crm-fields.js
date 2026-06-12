import { createClient } from '@supabase/supabase-js';
import { getConfig } from '../src/config.js';

const config = getConfig();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || config.supabase.url;
const key = config.supabase.serviceRoleKey;

if (!url || !key) {
  console.error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const limit = clamp(Number(process.env.LEGACY_CRM_SYNC_LIMIT || 1000), 1, 5000);
const { data: orders, error } = await supabase
  .from('orders')
  .select(`
    id,wix_order_id,order_number,status,payment_status,fulfillment_status,total_amount,currency,
    shipment_status,shipment_waybill,shipment_courier_code,shipment_service_code,shipment_service_mode,
    shipment_label_url,shipment_label_format,shipment_label_error,source_created_at,raw_order
  `)
  .order('source_created_at', { ascending: false })
  .limit(limit);

if (error) {
  console.error(`Could not read legacy orders: ${error.message}`);
  process.exit(1);
}

let updated = 0;
let failed = 0;
let missingCrmColumns = false;

for (const order of orders || []) {
  const patch = buildCrmPatch(order);
  const { error: updateError } = await supabase.from('orders').update(patch).eq('id', order.id);
  if (updateError) {
    failed += 1;
    if (isMissingColumnError(updateError)) {
      missingCrmColumns = true;
      console.error(
        `CRM columns are missing on orders. Apply supabase/migrations/004_operations_crm.sql, then rerun this script. First error: ${updateError.message}`
      );
      break;
    }
    console.error(`Order ${order.order_number || order.wix_order_id} failed: ${updateError.message}`);
    continue;
  }
  updated += 1;
}

console.log(JSON.stringify({ done: true, scanned: orders?.length || 0, updated, failed, missingCrmColumns }, null, 2));

function buildCrmPatch(order) {
  const raw = order.raw_order || {};
  const firstItem = raw.lineItems?.[0] || {};
  const awb = order.shipment_waybill || '';
  const courier = order.shipment_courier_code || '';
  return stripUndefined({
    external_order_id: order.wix_order_id || null,
    source: 'wix',
    internal_status: legacyInternalStatus(order),
    installation_status: order.shipment_status === 'delivered' ? 'not_contacted' : 'not_contacted',
    installation_method: 'unknown',
    feedback_status: 'feedback_pending',
    bike_model: extractBikeModel(firstItem),
    product_variant: firstItem.productName?.original || firstItem.productName?.translated || firstItem.productName || '',
    quantity: Number(firstItem.quantity || 1),
    courier: courier || null,
    awb_number: awb || null,
    tracking_url: awb ? trackingUrlFor(courier, awb) : null,
    shipment_label_url: order.shipment_label_url || null,
    shipment_label_format: order.shipment_label_format || null,
    shipment_label_error: order.shipment_label_error || null,
    updated_at: new Date().toISOString()
  });
}

function legacyInternalStatus(order) {
  if (order.status === 'CANCELED') return 'cancelled';
  if (!isPaidStatus(order.payment_status)) return 'not_paid';
  const shipmentStatus = order.shipment_status || '';
  const hasTracking = Boolean(order.shipment_waybill);
  if (shipmentStatus === 'delivered') return 'installation_pending';
  if (shipmentStatus === 'in-transit') return 'in_transit';
  if (shipmentStatus === 'pending-international') return 'shipment_booked';
  if (hasTracking) return 'shipment_booked';
  if (order.fulfillment_status === 'FULFILLED') return 'fulfilled_no_tracking';
  return 'awaiting_packing';
}

function extractBikeModel(item) {
  return (
    item.descriptionLines?.find?.(line => /bike|model/i.test(line.name?.original || ''))?.plainText?.original ||
    item.descriptionLines?.find?.(line => /bike|model/i.test(line.name || ''))?.plainText ||
    ''
  );
}

function trackingUrlFor(courier, awb) {
  if (!awb) return '';
  if (courier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(awb)}`;
  if (courier === 'usps') return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(awb)}`;
  if (courier === 'dtdc') return `https://trackcourier.io/track-and-trace/dtdc/${encodeURIComponent(awb)}`;
  if (courier === 'aramex') return `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(awb)}`;
  if (courier === 'uniuni') return `https://www.uniuni.com/tracking/?no=${encodeURIComponent(awb)}`;
  if (courier === 'shiprocket') return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

function isPaidStatus(status) {
  return ['PAID', 'APPROVED', 'paid', 'approved'].includes(status);
}

function isMissingColumnError(error) {
  return Boolean(
    error &&
      (error.code === '42703' ||
        error.code === 'PGRST204' ||
        /column .* does not exist|could not find .* column|schema cache/i.test(error.message || ''))
  );
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
