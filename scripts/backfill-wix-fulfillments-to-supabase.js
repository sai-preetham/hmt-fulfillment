import process from 'node:process';
import { getConfig } from '../src/config.js';
import { isSupabaseConfigured, SupabaseRestClient } from '../src/supabase.js';

const config = getConfig();
const supabase = new SupabaseRestClient(config);
const dryRun = process.env.DRY_RUN === 'true';
const orderPageSize = clamp(Number(process.env.WIX_FULFILLMENT_BACKFILL_ORDER_PAGE_SIZE || 500), 1, 1000);
const wixBatchSize = clamp(Number(process.env.WIX_FULFILLMENT_BACKFILL_WIX_BATCH_SIZE || 100), 1, 100);

if (!config.wix.authToken || !config.wix.siteId) {
  console.error('WIX_AUTH_TOKEN and WIX_SITE_ID are required.');
  process.exit(1);
}

if (!isSupabaseConfigured(config)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const stats = {
  fulfilledOrders: 0,
  scanned: 0,
  fulfillments: 0,
  imported: 0,
  updated: 0,
  skippedExisting: 0,
  noTracking: 0,
  nonShipment: 0,
  errors: 0,
  dryRun
};

const fulfilledOrders = await listFulfilledOrders();
stats.fulfilledOrders = fulfilledOrders.length;

const existingShipments = await listExistingShipments();
const shipmentByOrderId = new Map(existingShipments.filter(row => row.order_id).map(row => [row.order_id, row]));
const shipmentByWixOrderId = new Map(existingShipments.filter(row => row.legacy_order_id).map(row => [row.legacy_order_id, row]));
const shipmentByOrderNumber = new Map(existingShipments.filter(row => row.order_number).map(row => [row.order_number, row]));

for (const orderBatch of chunks(fulfilledOrders, wixBatchSize)) {
  const fulfillmentsByOrderId = await listWixFulfillments(orderBatch.map(order => order.wix_order_id));

  for (const order of orderBatch) {
    stats.scanned += 1;

    if (order.shipment_waybill) {
      stats.skippedExisting += 1;
      continue;
    }

    const fulfillments = fulfillmentsByOrderId.get(order.wix_order_id) || [];
    const fulfillment = latestFulfillmentWithTracking(fulfillments);
    if (!fulfillment) {
      stats.noTracking += 1;
      continue;
    }

    try {
      const tracking = normalizeTracking(fulfillment);
      if (isNonShipmentTracking(tracking)) {
        stats.nonShipment += 1;
        continue;
      }

      stats.fulfillments += 1;
      const existingShipment =
        shipmentByOrderId.get(order.id) ||
        shipmentByWixOrderId.get(order.wix_order_id) ||
        shipmentByOrderNumber.get(order.order_number);

      const shipmentRow = buildShipmentRow(order, fulfillment, tracking);
      const orderPatch = buildOrderPatch(fulfillment, tracking);

      if (dryRun) {
        console.log(`${order.order_number}: would import ${tracking.waybill} (${tracking.provider || tracking.serviceCode})`);
        continue;
      }

      const savedShipment = existingShipment
        ? await supabase.patch('shipments', `id=eq.${encodeURIComponent(existingShipment.id)}`, {
            ...shipmentRow,
            updated_at: new Date().toISOString()
          })
        : await supabase.insert('shipments', shipmentRow);

      await supabase.patch('orders', `id=eq.${encodeURIComponent(order.id)}`, orderPatch);

      shipmentByOrderId.set(order.id, savedShipment);
      if (order.wix_order_id) shipmentByWixOrderId.set(order.wix_order_id, savedShipment);
      if (order.order_number) shipmentByOrderNumber.set(order.order_number, savedShipment);
      stats[existingShipment ? 'updated' : 'imported'] += 1;
      console.log(`${order.order_number}: imported ${tracking.waybill} (${tracking.provider || tracking.serviceCode})`);
    } catch (error) {
      stats.errors += 1;
      console.error(`${order.order_number}: ${error.message}`);
    }
  }
}

console.log(JSON.stringify(stats, null, 2));
if (stats.errors > 0) process.exitCode = 1;

async function listFulfilledOrders() {
  const orders = [];
  let offset = 0;

  while (true) {
    const rows = await supabase.select(
      'orders',
      [
        'select=id,wix_order_id,order_number,fulfillment_status,shipment_waybill,source_created_at',
        'fulfillment_status=eq.FULFILLED',
        'order=source_created_at.desc',
        `limit=${orderPageSize}`,
        `offset=${offset}`
      ].join('&')
    );
    orders.push(...rows.filter(order => order.wix_order_id));
    if (rows.length < orderPageSize) break;
    offset += orderPageSize;
  }

  return orders;
}

async function listExistingShipments() {
  const shipments = [];
  let offset = 0;

  while (true) {
    const rows = await supabase.select(
      'shipments',
      [
        'select=id,order_id,legacy_order_id,order_number,waybill,status,updated_at',
        'order=updated_at.desc',
        `limit=${orderPageSize}`,
        `offset=${offset}`
      ].join('&')
    );
    shipments.push(...rows);
    if (rows.length < orderPageSize) break;
    offset += orderPageSize;
  }

  return shipments;
}

async function listWixFulfillments(orderIds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.wix.requestTimeoutMs || 30_000);
  timeout.unref?.();

  try {
    const response = await fetch('https://www.wixapis.com/ecom/v1/fulfillments/list-by-ids', {
      method: 'POST',
      headers: wixHeaders(),
      body: JSON.stringify({ orderIds }),
      signal: controller.signal
    });
    const body = await safeJson(response);
    if (!response.ok) {
      throw new Error(`Wix List Fulfillments failed (${response.status}): ${JSON.stringify(body)}`);
    }

    return new Map(
      (body.ordersWithFulfillments || []).map(order => [order.orderId, order.fulfillments || []])
    );
  } finally {
    clearTimeout(timeout);
  }
}

function latestFulfillmentWithTracking(fulfillments) {
  return fulfillments
    .filter(fulfillment => normalizeTracking(fulfillment).waybill)
    .sort((a, b) => Date.parse(b.createdDate || b.updatedDate || 0) - Date.parse(a.createdDate || a.updatedDate || 0))[0];
}

function buildShipmentRow(order, fulfillment, tracking) {
  const observedAt = new Date().toISOString();
  const bookedAt = fulfillment.createdDate || fulfillment.updatedDate || observedAt;

  return {
    order_id: order.id,
    legacy_order_id: order.wix_order_id,
    order_number: order.order_number,
    direction: 'forward',
    flow: tracking.flow,
    courier_code: tracking.courierCode,
    courier_service_code: tracking.serviceCode,
    service_mode: tracking.serviceMode,
    status: 'booked',
    waybill: tracking.waybill,
    carrier_response: {
      source: 'wix_fulfillment_import',
      fulfillment
    },
    message: 'Imported from Wix fulfillment tracking data',
    created_at: bookedAt,
    updated_at: observedAt
  };
}

function buildOrderPatch(fulfillment, tracking) {
  const observedAt = new Date().toISOString();
  const bookedAt = fulfillment.createdDate || fulfillment.updatedDate || observedAt;

  return {
    shipment_status: 'booked',
    shipment_waybill: tracking.waybill,
    shipment_courier_code: tracking.courierCode,
    shipment_service_code: tracking.serviceCode,
    shipment_service_mode: tracking.serviceMode,
    shipment_booked_at: bookedAt,
    shipment_updated_at: observedAt,
    wix_fulfillment_status: 'synced',
    wix_fulfillment_id: fulfillment.id || null,
    wix_fulfillment_synced_at: observedAt,
    wix_fulfillment_error: null,
    updated_at: observedAt
  };
}

function normalizeTracking(fulfillment) {
  const info = fulfillment.trackingInfo || fulfillment.tracking || {};
  const waybill = firstValue(
    info.trackingNumber,
    info.trackingNo,
    info.number,
    fulfillment.trackingNumber,
    fulfillment.trackingNo
  );
  const provider = firstValue(
    info.shippingProvider,
    info.provider,
    info.providerName,
    info.carrier,
    fulfillment.shippingProvider,
    fulfillment.providerName
  );
  const normalizedProvider = String(provider || '').toLowerCase();
  const link = firstValue(info.trackingLink, info.trackingUrl, info.url, fulfillment.trackingLink, fulfillment.trackingUrl);

  if (normalizedProvider.includes('delhivery')) {
    const isSurface = normalizedProvider.includes('surface');
    return {
      waybill,
      provider,
      trackingUrl: link || trackingUrl(waybill),
      flow: 'domestic',
      courierCode: 'delhivery',
      serviceCode: isSurface ? 'surface' : 'express',
      serviceMode: isSurface ? 'Surface' : 'Express'
    };
  }

  if (normalizedProvider.includes('fedex')) {
    return {
      waybill,
      provider,
      trackingUrl: link,
      flow: 'international',
      courierCode: 'fedex',
      serviceCode: 'fedex',
      serviceMode: provider || 'FedEx'
    };
  }

  if (normalizedProvider.includes('srx') || normalizedProvider.includes('asendia')) {
    return {
      waybill,
      provider,
      trackingUrl: link,
      flow: 'international',
      courierCode: 'asendia',
      serviceCode: 'international',
      serviceMode: provider || 'International'
    };
  }

  const fallbackCode = normalizeCode(provider || 'external');
  return {
    waybill,
    provider,
    trackingUrl: link,
    flow: 'international',
    courierCode: fallbackCode,
    serviceCode: fallbackCode,
    serviceMode: provider || 'External'
  };
}

function trackingUrl(waybill) {
  if (!waybill) return null;
  return (config.wix.trackingUrlTemplate || config.delhivery.trackingUrlTemplate || '').replace('{waybill}', waybill);
}

function wixHeaders() {
  return removeEmpty({
    Authorization: config.wix.authToken,
    'Content-Type': 'application/json',
    'wix-site-id': config.wix.siteId,
    'wix-account-id': config.wix.accountId
  });
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') || null;
}

function normalizeCode(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'external';
}

function isNonShipmentTracking(tracking) {
  const provider = String(tracking.provider || '').toLowerCase();
  const waybill = String(tracking.waybill || '').toLowerCase();
  return provider.includes('in-hand') || provider.includes('in hand') || waybill.includes('install');
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}
