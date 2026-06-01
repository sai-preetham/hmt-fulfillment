import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildAudit, normalizeShipmentRecord, normalizeWixOrder } from './fulfillment.js';
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
  return supabase.select(
    'orders',
    'select=id,wix_order_id,order_number,status,payment_status,fulfillment_status,currency,total_amount,shipping_amount,selected_shipping_title,source_created_at,updated_at,customers(name,email,phone)&order=source_created_at.desc&limit=100'
  );
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
  const nextRecord = existing
    ? await supabase.patch('shipments', `id=eq.${existing.id}`, {
        ...normalized,
        updated_at: new Date().toISOString()
      })
    : await supabase.insert('shipments', normalized);

  await writeAudit(supabase, 'shipments', nextRecord.id, existing ? 'update' : 'insert', before, nextRecord, 'shipment upsert');

  if (record.requestPayload || record.delhiveryResponse || record.error) {
    await insertShipmentAttempt(supabase, nextRecord, record);
  }

  return denormalizeShipment(nextRecord);
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
    error: row.error || '',
    message: row.message || '',
    source: row.courier_code,
    shippingMode: row.courier_service_code === 'surface' ? 'S' : 'E',
    internationalService: row.flow === 'international' ? row.service_mode : '',
    reverse: row.direction === 'reverse'
  };
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
