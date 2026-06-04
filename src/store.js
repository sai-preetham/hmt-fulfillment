import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildAudit, buildOrderShipmentSummary, normalizeShipmentRecord, normalizeWixOrder } from './fulfillment.js';
import { getConfig } from './config.js';
import { isSupabaseConfigured, SupabaseRestClient } from './supabase.js';

const STORE_PATH = new URL('../data/shipments.json', import.meta.url);

export async function listShipments() {
  const supabase = getSupabaseClient();
  if (supabase) return listSupabaseShipments(supabase);
  return readStore();
}

export async function listOrders() {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  return listDashboardOrders({ queue: 'all_recent', limit: 100 });
}

export async function listDashboardOrders({ queue = 'needs_shipping', limit = 100 } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const rows = await supabase.select(
    'orders',
    `${orderSelect()}&order=source_created_at.desc&limit=${Math.min(Math.max(Number(limit) || 100, 1), 200)}`
  );
  return rows.filter(order => matchesDashboardQueue(order, queue));
}

export async function listInternationalExportOrders({ limit = 500 } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const rows = await supabase.select(
    'orders',
    `${orderSelect()}&order=source_created_at.desc&limit=${Math.min(Math.max(Number(limit) || 500, 1), 1000)}`
  );
  return rows.filter(isExportableInternationalOrder);
}

export async function findShipmentByOrderId(orderId) {
  const supabase = getSupabaseClient();
  if (supabase) {
    const rows = await supabase.select(
      'shipments',
      `legacy_order_id=eq.${encodeURIComponent(orderId)}&order=created_at.desc&limit=1`
    );
    return rows[0] ? denormalizeShipment(rows[0]) : undefined;
  }

  const shipments = await readStore();
  return shipments.find(shipment => shipment.orderId === orderId);
}

export async function upsertShipment(record) {
  const supabase = getSupabaseClient();
  if (supabase) return upsertSupabaseShipment(supabase, record);

  const shipments = await readStore();
  const index = shipments.findIndex(shipment => {
    if (record.orderId && shipment.orderId === record.orderId) return true;
    if (record.eventId && shipment.eventId === record.eventId) return true;
    return false;
  });
  const nextRecord = {
    ...shipments[index],
    ...record,
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) {
    shipments[index] = nextRecord;
  } else {
    shipments.unshift({
      createdAt: new Date().toISOString(),
      ...nextRecord
    });
  }

  await writeStore(shipments);
  return nextRecord;
}

export async function findOrderById(id) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const rows = await supabase.select('orders', `id=eq.${encodeURIComponent(id)}&${orderSelect()}`);
  return rows[0] || null;
}

export async function findShipmentById(id) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const rows = await supabase.select('shipments', `id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

export async function findLatestShipmentForOrder(order) {
  const supabase = getSupabaseClient();
  if (!supabase || !order) return null;
  const filters = [];
  if (order.id) filters.push(`order_id.eq.${encodeURIComponent(order.id)}`);
  if (order.wix_order_id) filters.push(`legacy_order_id.eq.${encodeURIComponent(order.wix_order_id)}`);
  if (order.order_number) filters.push(`order_number.eq.${encodeURIComponent(order.order_number)}`);
  if (!filters.length) return null;
  const rows = await supabase.select('shipments', `or=(${filters.join(',')})&order=updated_at.desc&limit=1`);
  return rows[0] || null;
}

export async function listShipmentAttempts(shipmentId) {
  const supabase = getSupabaseClient();
  if (!supabase || !shipmentId) return [];
  return supabase.select(
    'shipment_attempts',
    `shipment_id=eq.${encodeURIComponent(shipmentId)}&order=created_at.desc&limit=10`
  );
}

export async function updateOrderWixFulfillment(id, fields) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  return supabase.patch('orders', `id=eq.${encodeURIComponent(id)}`, {
    wix_fulfillment_status: fields.status || null,
    wix_fulfillment_id: fields.fulfillmentId || null,
    wix_fulfillment_synced_at: fields.syncedAt || null,
    wix_fulfillment_error: fields.error || null,
    updated_at: new Date().toISOString()
  });
}

export async function updateShipmentLabel(id, fields) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const shipment = await supabase.patch('shipments', `id=eq.${encodeURIComponent(id)}`, {
    label_url: fields.label_url || null,
    label_format: fields.label_format || null,
    label_generated_at: fields.label_generated_at || null,
    label_error: fields.label_error || null,
    updated_at: new Date().toISOString()
  });
  if (shipment?.order_id) {
    await supabase.patch('orders', `id=eq.${shipment.order_id}`, {
      shipment_label_url: shipment.label_url || null,
      shipment_label_format: shipment.label_format || null,
      shipment_label_error: shipment.label_error || null,
      updated_at: new Date().toISOString()
    });
  }
  return shipment;
}

export async function upsertWixOrder(order) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  return upsertSupabaseWixOrder(supabase, order);
}

export async function upsertWixOrders(orders) {
  const results = [];
  for (const order of orders) {
    results.push(await upsertWixOrder(order));
  }
  return results.filter(Boolean);
}

async function listSupabaseShipments(supabase) {
  const rows = await supabase.select('shipments', 'order=created_at.desc&limit=100');
  return rows.map(denormalizeShipment);
}

async function upsertSupabaseShipment(supabase, record) {
  const normalized = normalizeShipmentRecord(record);
  const existing = record.id
    ? await findSupabaseShipmentById(supabase, record.id)
    : await findLatestSupabaseShipment(supabase, record.orderId);
  const before = existing || null;
  const shipmentRow = existing ? mergeShipmentUpdate(existing, normalized) : normalized;
  const nextRecord = existing
    ? await supabase.patch('shipments', `id=eq.${existing.id}`, {
        ...shipmentRow,
        updated_at: new Date().toISOString()
      })
    : await supabase.insert('shipments', shipmentRow);

  await writeAudit(supabase, 'shipments', nextRecord.id, existing ? 'update' : 'insert', before, nextRecord, 'shipment upsert');
  await syncOrderShipmentSummary(supabase, nextRecord);

  if (record.requestPayload || record.delhiveryResponse || record.error) {
    await insertShipmentAttempt(supabase, nextRecord, record);
  }

  return denormalizeShipment(nextRecord);
}

function mergeShipmentUpdate(existing, normalized) {
  return {
    ...normalized,
    order_id: normalized.order_id || existing.order_id,
    legacy_order_id: normalized.legacy_order_id || existing.legacy_order_id,
    order_number: normalized.order_number || existing.order_number,
    courier_code: normalized.courier_code || existing.courier_code,
    courier_service_code: normalized.courier_service_code || existing.courier_service_code,
    service_mode: normalized.service_mode || existing.service_mode,
    request_payload:
      normalized.request_payload && Object.keys(normalized.request_payload).length
        ? normalized.request_payload
        : existing.request_payload,
    carrier_response: normalized.carrier_response || existing.carrier_response,
    waybill: normalized.waybill || existing.waybill,
    upload_wbn: normalized.upload_wbn || existing.upload_wbn,
    pickup_location: normalized.pickup_location || existing.pickup_location
  };
}

async function syncOrderShipmentSummary(supabase, shipment) {
  if (!shipment.order_id) return;
  await supabase.patch('orders', `id=eq.${shipment.order_id}`, buildOrderShipmentSummary(shipment));
}

async function upsertSupabaseWixOrder(supabase, order) {
  const normalized = normalizeWixOrder(order, getConfig());
  const existingOrder = await findSupabaseOrderByWixId(supabase, normalized.order.wix_order_id);
  const customer = await upsertCustomer(supabase, normalized.customer);
  const shippingAddress = await insertAddress(supabase, customer.id, normalized.shippingAddress);
  const billingAddress = await insertAddress(supabase, customer.id, normalized.billingAddress);
  const orderRow = {
    ...normalized.order,
    customer_id: customer.id,
    shipping_address_id: shippingAddress?.id || null,
    billing_address_id: billingAddress?.id || null,
    updated_at: new Date().toISOString()
  };
  const savedOrder = await supabase.upsert('orders', orderRow, 'wix_order_id');

  await supabase.insert('order_source_versions', {
    order_id: savedOrder.id,
    source: 'wix',
    raw_order: normalized.order.raw_order
  });

  for (const item of normalized.items) {
    await supabase.upsert('order_items', { ...item, order_id: savedOrder.id }, 'order_id,wix_line_item_id');
    if (item.sku) {
      await supabase.upsert(
        'inventory_items',
        {
          sku: item.sku,
          product_name: item.product_name,
          hsn_code: item.hsn_code,
          default_weight_grams: item.weight ? item.weight * 1000 : null
        },
        'sku'
      );
    }
  }

  await supabase.upsert('payment_refs', { ...normalized.payment, order_id: savedOrder.id }, 'order_id');
  await writeAudit(
    supabase,
    'orders',
    savedOrder.id,
    existingOrder ? 'wix_resync' : 'wix_import',
    existingOrder,
    savedOrder,
    'wix order sync'
  );
  return savedOrder;
}

async function upsertCustomer(supabase, customer) {
  if (customer.wix_contact_id) return supabase.upsert('customers', customer, 'wix_contact_id');
  return supabase.insert('customers', customer);
}

async function insertAddress(supabase, customerId, address) {
  if (!address?.raw_address?.address || Object.keys(address.raw_address.address).length === 0) return null;
  return supabase.insert('customer_addresses', { ...address, customer_id: customerId });
}

async function insertShipmentAttempt(supabase, shipment, record) {
  const existing = await supabase.select('shipment_attempts', `shipment_id=eq.${shipment.id}&select=attempt_number`);
  const attemptNumber = existing.length + 1;
  await supabase.insert('shipment_attempts', {
    shipment_id: shipment.id,
    attempt_number: attemptNumber,
    request_payload: record.requestPayload || {},
    response_payload: record.delhiveryResponse || null,
    success: record.status === 'booked',
    error: record.error || null
  });
}

async function findLatestSupabaseShipment(supabase, legacyOrderId) {
  if (!legacyOrderId) return null;
  const rows = await supabase.select(
    'shipments',
    `legacy_order_id=eq.${encodeURIComponent(legacyOrderId)}&order=created_at.desc&limit=1`
  );
  return rows[0] || null;
}

async function findSupabaseShipmentById(supabase, id) {
  const rows = await supabase.select('shipments', `id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

async function findSupabaseOrderByWixId(supabase, wixOrderId) {
  const rows = await supabase.select('orders', `wix_order_id=eq.${encodeURIComponent(wixOrderId)}&limit=1`);
  return rows[0] || null;
}

async function writeAudit(supabase, tableName, recordId, action, beforeJson, afterJson, reason) {
  await supabase.insert('audit_log', buildAudit(tableName, recordId, action, beforeJson, afterJson, reason));
}

function getSupabaseClient() {
  const config = getConfig();
  return isSupabaseConfigured(config) ? new SupabaseRestClient(config) : null;
}

function denormalizeShipment(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderId: row.legacy_order_id,
    orderNumber: row.order_number,
    status: row.status,
    requestPayload: row.request_payload,
    delhiveryResponse: row.carrier_response,
    waybill: row.waybill || '',
    labelUrl: row.label_url || '',
    labelFormat: row.label_format || '',
    labelError: row.label_error || '',
    error: row.error || '',
    message: row.message || '',
    source: row.courier_code,
    shippingMode: row.courier_service_code === 'surface' ? 'S' : 'E',
    internationalService: row.flow === 'international' ? row.service_mode : '',
    reverse: row.direction === 'reverse'
  };
}

function orderSelect() {
  return [
    'select=id,wix_order_id,order_number,status,payment_status,fulfillment_status,currency,total_amount,shipping_amount,selected_shipping_title',
    'shipment_status,shipment_waybill,shipment_courier_code,shipment_service_code,shipment_service_mode,shipment_booked_at,shipment_updated_at',
    'shipment_label_url,shipment_label_format,shipment_label_error',
    'wix_fulfillment_status,wix_fulfillment_id,wix_fulfillment_synced_at,wix_fulfillment_error',
    'source_created_at,source_updated_at,updated_at,raw_order,customers(name,email,phone)'
  ].join(',');
}

function matchesDashboardQueue(order, queue) {
  if (queue === 'all_recent') return true;
  if (queue === 'booked') return order.shipment_status === 'booked';
  if (queue === 'failed') return order.shipment_status === 'failed';
  if (queue === 'international_pending') return order.shipment_status === 'pending-international';
  if (queue === 'wix_update_failed') return order.wix_fulfillment_status === 'failed';
  return (
    ['PAID', 'APPROVED'].includes(order.payment_status) ||
    ['APPROVED'].includes(order.status)
  ) && !order.shipment_waybill && !['booked', 'pending-international'].includes(order.shipment_status || '');
}

function isExportableInternationalOrder(order) {
  const country = order.raw_order?.shippingInfo?.logistics?.shippingDestination?.address?.country;
  const normalizedCountry = String(country || '').trim().toUpperCase();
  const isInternational = normalizedCountry && !['IN', 'IND', 'INDIA'].includes(normalizedCountry);
  return (
    isInternational &&
    !order.shipment_waybill &&
    ['PAID', 'APPROVED'].includes(order.payment_status || order.status || '')
  );
}

async function readStore() {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeStore(shipments) {
  await mkdir(dirname(STORE_PATH.pathname), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(shipments, null, 2));
}
