import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildAudit, buildOrderShipmentSummary, normalizeShipmentRecord, normalizeWixOrder, normalizeAmazonOrder } from './fulfillment.js';
import { getConfig } from './config.js';
import { isSupabaseConfigured, SupabaseRestClient } from './supabase.js';

const STORE_PATH = join(process.cwd(), 'data', 'shipments.json');

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

export async function listDashboardOrders({ queue = 'needs_packing', limit = 100 } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const querySuffix = `&order=source_created_at.desc&limit=${Math.min(Math.max(Number(limit) || 100, 1), 200)}`;
  const rows = await selectOrdersWithSchemaFallback(supabase, querySuffix);
  return rows.filter(order => matchesDashboardQueue(order, normalizeDashboardQueue(queue)));
}

export async function listInternationalExportOrders({ limit = 500 } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const rows = await selectOrdersWithSchemaFallback(
    supabase,
    `&order=source_created_at.desc&limit=${Math.min(Math.max(Number(limit) || 500, 1), 1000)}`
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
  const rows = await selectOrdersWithSchemaFallback(supabase, `&id=eq.${encodeURIComponent(id)}`);
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

export async function upsertWixFulfillmentTracking(order, fulfillments = []) {
  const trackedFulfillments = fulfillments.filter(fulfillment => fulfillment?.trackingInfo?.trackingNumber);
  if (!trackedFulfillments.length) return { persisted: 0 };

  let persisted = 0;
  for (const fulfillment of trackedFulfillments) {
    const tracking = fulfillment.trackingInfo || {};
    const shipment = await upsertShipment({
      dbOrderId: order.id,
      orderId: order.wix_order_id,
      orderNumber: order.order_number,
      status: inferShipmentStatusFromWixFulfillment(fulfillment),
      courierCode: inferCourierCodeFromTracking(tracking),
      waybill: tracking.trackingNumber,
      shippingMode: tracking.shippingProvider,
      source: 'wix-fulfillment',
      requestPayload: {
        source: 'wix-fulfillment',
        fulfillment
      },
      delhiveryResponse: {
        source: 'wix',
        fulfillmentId: fulfillment.id || null,
        trackingInfo: tracking,
        createdDate: fulfillment.createdDate || null,
        updatedDate: fulfillment.updatedDate || null
      }
    });

    await updateOrderWixFulfillment(order.id, {
      status: 'synced_from_wix',
      fulfillmentId: fulfillment.id || '',
      syncedAt: new Date().toISOString(),
      error: null
    });
    if (shipment) persisted += 1;
  }

  return { persisted };
}

export async function packOrder(orderId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const existing = await supabase.select('pick_pack_tasks', `order_id=eq.${encodeURIComponent(orderId)}&limit=1`);
  const now = new Date().toISOString();

  if (existing && existing.length > 0) {
    return supabase.patch('pick_pack_tasks', `id=eq.${existing[0].id}`, {
      status: 'packed',
      packed_at: now,
      updated_at: now
    });
  } else {
    return supabase.insert('pick_pack_tasks', {
      order_id: orderId,
      status: 'packed',
      packed_at: now
    });
  }
}

export async function logBuyerCall(orderId, callStatus, notes) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const now = new Date().toISOString();
  const normalizedStatus = normalizeBuyerCallStatus(callStatus);

  const updatedOrder = await supabase.patch('orders', `id=eq.${encodeURIComponent(orderId)}`, {
    buyer_call_status: normalizedStatus,
    buyer_call_notes: notes || null,
    buyer_called_at: now,
    updated_at: now
  });

  await supabase.insert('buyer_calls', {
    order_id: orderId,
    call_status: normalizedStatus,
    notes: notes || null,
    called_at: now
  });

  return updatedOrder;
}

/**
 * Locally mark an order as fulfilled so it drops out of the packing/booking queues.
 * Does not call Wix — use syncBookedShipmentToWix for that.
 *
 * @param {string} orderId  DB order UUID
 */
export async function markOrderFulfilled(orderId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  return supabase.patch('orders', `id=eq.${encodeURIComponent(orderId)}`, {
    fulfillment_status: 'FULFILLED',
    updated_at: new Date().toISOString()
  });
}

export async function updateShipmentStatus(shipmentId, status) {

  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const now = new Date().toISOString();

  const shipment = await supabase.patch('shipments', `id=eq.${encodeURIComponent(shipmentId)}`, {
    status: status,
    updated_at: now
  });

  if (shipment) {
    await syncOrderShipmentSummary(supabase, shipment);
  }

  return shipment;
}

/**
 * Return all shipments that have a waybill and are not in a terminal state.
 * Used by the tracking poller.
 *
 * @returns {Promise<Array<{id, waybill, order_id, status, courier_code}>>}
 */
export async function listActiveShipmentWaybills() {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  // Fetch booked/in-transit shipments that have a real AWB
  const rows = await supabase.select(
    'shipments',
    'select=id,waybill,order_id,status,courier_code' +
      '&waybill=not.is.null' +
      '&status=not.in.(delivered,rto,cancelled,failed)' +
      '&order=updated_at.asc' +
      '&limit=500'
  );
  // Filter out empty-string waybills (Supabase `not.is.null` won't catch those)
  return (rows || []).filter(r => r.waybill && r.waybill.trim());
}

/**
 * Persist new tracking scan events for a shipment.
 * Duplicates (same shipment_id + occurred_at + event_status) are silently
 * ignored via the unique index `idx_shipment_events_dedup`.
 *
 * @param {string} shipmentId
 * @param {Array} events  Normalised event objects from `extractTrackingEvents()`
 * @returns {Promise<number>} Number of new events inserted
 */
export async function saveTrackingEvents(shipmentId, events) {
  const supabase = getSupabaseClient();
  if (!supabase || !events.length) return 0;

  let inserted = 0;
  for (const event of events) {
    try {
      await supabase.insert('shipment_events', {
        shipment_id: shipmentId,
        event_status: event.event_status || null,
        normalized_status: event.normalized_status || null,
        carrier_location: event.carrier_location || null,
        message: event.message || null,
        occurred_at: event.occurred_at || new Date().toISOString(),
        raw_event: event.raw_event || {}
      });
      inserted += 1;
    } catch (error) {
      // Unique-constraint violation means we already have this event — skip
      if (!isUniqueViolation(error)) throw error;
    }
  }
  return inserted;
}

/**
 * Update a shipment's status after a tracking poll and propagate the
 * summary to the parent order row.
 *
 * @param {string} shipmentId
 * @param {{ status: string, location: string|null, lastEventAt: string }} fields
 */
export async function updateShipmentTracking(shipmentId, { status, lastEventAt }) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const now = new Date().toISOString();
  const shipment = await supabase.patch('shipments', `id=eq.${encodeURIComponent(shipmentId)}`, {
    status,
    updated_at: lastEventAt || now
  });

  if (shipment) {
    await syncOrderShipmentSummary(supabase, shipment);
  }

  return shipment;
}

async function listSupabaseShipments(supabase) {
  const rows = await supabase.select('shipments', 'order=created_at.desc&limit=100');
  return rows.map(denormalizeShipment);
}

async function upsertSupabaseShipment(supabase, record) {
  const normalized = normalizeShipmentRecord(record);
  const existing = record.id
    ? await findSupabaseShipmentById(supabase, record.id)
    : record.createNewShipment
      ? null
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
  const status = progressedShipmentStatus(existing.status, normalized.status);
  return {
    ...normalized,
    status,
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

function progressedShipmentStatus(current, next) {
  if (!current) return next;
  if (!next) return current;
  if (current === next) return current;
  if (['delivered', 'rto', 'failed', 'cancelled'].includes(current)) return current;

  const order = ['pending', 'booked', 'pickup_pending', 'picked-up', 'dispatched', 'in-transit', 'out-for-delivery', 'delivered', 'rto', 'failed', 'cancelled'];
  const currentRank = order.indexOf(current);
  const nextRank = order.indexOf(next);
  if (currentRank === -1 || nextRank === -1) return next;
  return nextRank >= currentRank ? next : current;
}

async function syncOrderShipmentSummary(supabase, shipment) {
  if (!shipment.order_id) return;
  await supabase.patch('orders', `id=eq.${shipment.order_id}`, buildOrderShipmentSummary(shipment));
}

async function upsertSupabaseWixOrder(supabase, order) {
  const normalized = normalizeWixOrder(order, getConfig());
  const existingOrder = await findSupabaseOrderByWixId(supabase, normalized.order.wix_order_id);
  const customer = await upsertCustomer(supabase, normalized.customer);
  const shippingAddress = existingOrder?.shipping_address_id
    ? { id: existingOrder.shipping_address_id }
    : await insertAddress(supabase, customer.id, normalized.shippingAddress);
  const billingAddress = existingOrder?.billing_address_id
    ? { id: existingOrder.billing_address_id }
    : await insertAddress(supabase, customer.id, normalized.billingAddress);
  const orderRow = {
    ...normalized.order,
    customer_id: customer.id,
    shipping_address_id: shippingAddress?.id || null,
    billing_address_id: billingAddress?.id || null,
    updated_at: new Date().toISOString()
  };
  const savedOrder = await supabase.upsert('orders', orderRow, 'wix_order_id');

  const rawChanged = !existingOrder || JSON.stringify(existingOrder.raw_order) !== JSON.stringify(normalized.order.raw_order);
  if (rawChanged) {
    await supabase.insert('order_source_versions', {
      order_id: savedOrder.id,
      source: 'wix',
      raw_order: normalized.order.raw_order
    });
  }

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
  if (customer.wix_contact_id) {
    const existing = await supabase.select('customers', `wix_contact_id=eq.${encodeURIComponent(customer.wix_contact_id)}&limit=1`);
    if (existing && existing.length > 0) {
      const merged = {
        ...customer,
        tax_id: existing[0].tax_id || customer.tax_id,
        tax_id_type: existing[0].tax_id_type || customer.tax_id_type,
        email: existing[0].email || customer.email,
        phone: existing[0].phone || customer.phone
      };
      return supabase.patch('customers', `id=eq.${existing[0].id}`, merged);
    }
  }
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
  // audit_log table has been dropped via migration 005_drop_audit_log.sql in favor of status_history.
  // We can skip writing to the database table.
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
  return orderSelectColumns({ includeBuyerCalls: true });
}

function orderSelectColumns({ includeBuyerCalls }) {
  return [
    'select=id,wix_order_id,order_number,status,payment_status,fulfillment_status,currency,total_amount,shipping_amount,selected_shipping_title',
    'shipment_status,shipment_waybill,shipment_courier_code,shipment_service_code,shipment_service_mode,shipment_booked_at,shipment_updated_at',
    'shipment_label_url,shipment_label_format,shipment_label_error',
    'wix_fulfillment_status,wix_fulfillment_id,wix_fulfillment_synced_at,wix_fulfillment_error',
    includeBuyerCalls ? 'buyer_call_status,buyer_call_notes,buyer_called_at' : '',
    'source_created_at,source_updated_at,updated_at,raw_order,customers(name,email,phone)',
    'pick_pack_tasks(id,status,picked_at,packed_at,notes)'
  ].filter(Boolean).join(',');
}

async function selectOrdersWithSchemaFallback(supabase, querySuffix = '') {
  try {
    return await supabase.select('orders', `${orderSelectColumns({ includeBuyerCalls: true })}${querySuffix}`);
  } catch (error) {
    if (!isMissingBuyerCallSchemaError(error)) throw error;
    const rows = await supabase.select('orders', `${orderSelectColumns({ includeBuyerCalls: false })}${querySuffix}`);
    return rows.map(order => ({
      ...order,
      buyer_call_status: 'pending',
      buyer_call_notes: null,
      buyer_called_at: null
    }));
  }
}

function isMissingBuyerCallSchemaError(error) {
  return /buyer_call_status|buyer_call_notes|buyer_called_at/.test(error?.message || '');
}

export function matchesDashboardQueue(order, queue) {
  const normalizedQueue = normalizeDashboardQueue(queue);

  // Wix uses 'CANCELED' (one L). Never show cancelled orders in any active queue.
  const isCancelled = order.status === 'CANCELED';
  if (isCancelled) {
    return normalizedQueue === 'all_recent' || normalizedQueue === 'cancelled';
  }

  const isPaidOrApproved =
    ['PAID', 'APPROVED'].includes(order.payment_status) ||
    ['APPROVED'].includes(order.status);

  // An order already marked FULFILLED in Wix (in-person, manual, etc.) is done —
  // exclude it from packing/booking queues entirely.
  const isWixFulfilled = order.fulfillment_status === 'FULFILLED';

  const packStatus = getPackStatus(order);
  const hasAwb = Boolean(order.shipment_waybill);
  const shipmentStatus = normalizeShipmentStatus(order.shipment_status);
  const isBooked = shipmentStatus === 'booked';
  const isDelivered = shipmentStatus === 'delivered';
  const isTransit = ['in-transit', 'out-for-delivery', 'picked-up', 'dispatched'].includes(shipmentStatus);
  const buyerCallComplete = ['answered_confirmed', 'completed'].includes(order.buyer_call_status || '');

  if (normalizedQueue === 'all_recent') return true;
  if (normalizedQueue === 'cancelled') return false;
  if (normalizedQueue === 'failed') return shipmentStatus === 'failed';
  if (normalizedQueue === 'wix_update_failed') return order.wix_fulfillment_status === 'failed';
  if (normalizedQueue === 'international_pending') return shipmentStatus === 'pending-international';

  if (normalizedQueue === 'needs_packing') {
    return isPaidOrApproved && !hasAwb && !isWixFulfilled && packStatus !== 'packed' && shipmentStatus !== 'pending-international';
  }
  if (normalizedQueue === 'needs_booking') {
    return isPaidOrApproved && !hasAwb && !isWixFulfilled && packStatus === 'packed' && shipmentStatus !== 'pending-international';
  }
  if (normalizedQueue === 'ready_for_pickup') {
    return hasAwb && isBooked && !isTransit && !isDelivered;
  }
  if (normalizedQueue === 'in_transit') {
    return hasAwb && isTransit && !isDelivered;
  }
  if (normalizedQueue === 'needs_call') {
    return isDelivered && !buyerCallComplete;
  }
  if (normalizedQueue === 'completed') {
    return isDelivered && buyerCallComplete;
  }
  return false;
}

function normalizeDashboardQueue(queue) {
  if (queue === 'needs_shipping') return 'needs_packing';
  if (queue === 'booked') return 'ready_for_pickup';
  return queue || 'needs_packing';
}

function normalizeShipmentStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return '';
  if (normalized.startsWith('rto')) return 'rto';
  if (normalized.includes('delivered')) return 'delivered';
  if (normalized.includes('out for delivery') || normalized.includes('out-for-delivery')) return 'out-for-delivery';
  if (normalized.includes('in transit') || normalized.includes('in-transit') || normalized === 'intransit') return 'in-transit';
  if (normalized.includes('picked up') || normalized.includes('picked-up') || normalized === 'pickup') return 'picked-up';
  if (normalized.includes('dispatched')) return 'dispatched';
  if (normalized.includes('manifested') || normalized === 'booked') return 'booked';
  if (normalized.includes('failed') || normalized.includes('cancelled') || normalized.includes('canceled')) return 'failed';
  return normalized;
}

function normalizeBuyerCallStatus(status) {
  if (status === 'completed') return 'answered_confirmed';
  if (status === 'retry') return 'no_answer';
  return status;
}

function inferShipmentStatusFromWixFulfillment(fulfillment) {
  const status = String(fulfillment.status || fulfillment.fulfillmentStatus || '').trim().toLowerCase();
  if (status.includes('deliver')) return 'delivered';
  if (status.includes('transit') || status.includes('shipp')) return 'in-transit';
  if (status.includes('cancel')) return 'cancelled';
  return fulfillment.trackingInfo?.trackingNumber ? 'booked' : 'pending';
}

function inferCourierCodeFromTracking(tracking = {}) {
  const provider = String(tracking.shippingProvider || tracking.carrier || '').toLowerCase();
  const link = String(tracking.trackingLink || '').toLowerCase();
  if (provider.includes('fedex') || link.includes('fedex')) return 'fedex';
  if (provider.includes('maruti') || link.includes('shree')) return 'shree_maruti';
  if (provider.includes('shiprocket') || link.includes('shiprocket')) return 'shiprocket';
  if (provider.includes('delhivery') || link.includes('delhivery')) return 'delhivery';
  return provider.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'wix';
}

function getPackStatus(order) {
  const tasks = order.pick_pack_tasks || [];
  if (tasks.some(task => task.status === 'packed')) return 'packed';
  return tasks[0]?.status || 'open';
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
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(shipments, null, 2));
}

/**
 * Detect a Postgres unique-constraint violation (error code 23505) returned
 * as an error message from the Supabase REST client.
 */
function isUniqueViolation(error) {
  const msg = String(error?.message || '');
  return msg.includes('23505') || msg.includes('unique constraint') || msg.includes('duplicate key');
}

export async function upsertAmazonOrder(amazonPayload) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  return upsertSupabaseAmazonOrder(supabase, amazonPayload);
}

export async function upsertAmazonOrders(orders) {
  const results = [];
  for (const order of orders) {
    results.push(await upsertAmazonOrder(order));
  }
  return results.filter(Boolean);
}

async function upsertSupabaseAmazonOrder(supabase, amazonPayload) {
  const normalized = normalizeAmazonOrder(amazonPayload, getConfig());
  const existingOrder = await findSupabaseOrderByAmazonId(supabase, normalized.order.external_order_id);
  const customer = await upsertAmazonCustomer(supabase, normalized.customer);
  const shippingAddress = existingOrder?.shipping_address_id
    ? { id: existingOrder.shipping_address_id }
    : await insertAddress(supabase, customer.id, normalized.shippingAddress);
  const billingAddress = existingOrder?.billing_address_id
    ? { id: existingOrder.billing_address_id }
    : await insertAddress(supabase, customer.id, normalized.billingAddress);
  const orderRow = {
    ...normalized.order,
    customer_id: customer.id,
    shipping_address_id: shippingAddress?.id || null,
    billing_address_id: billingAddress?.id || null,
    updated_at: new Date().toISOString()
  };
  const savedOrder = await supabase.upsert('orders', orderRow, 'source,external_order_id');

  const rawChanged = !existingOrder || JSON.stringify(existingOrder.raw_order) !== JSON.stringify(normalized.order.raw_order);
  if (rawChanged) {
    await supabase.insert('order_source_versions', {
      order_id: savedOrder.id,
      source: 'amazon',
      raw_order: normalized.order.raw_order
    });
  }

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
    existingOrder ? 'amazon_resync' : 'amazon_import',
    existingOrder,
    savedOrder,
    'amazon order sync'
  );
  return savedOrder;
}

async function findSupabaseOrderByAmazonId(supabase, amazonOrderId) {
  if (!amazonOrderId) return null;
  const rows = await supabase.select('orders', `external_order_id=eq.${encodeURIComponent(amazonOrderId)}&source=eq.amazon&limit=1`);
  return rows[0] || null;
}

async function upsertAmazonCustomer(supabase, customer) {
  if (customer.email) {
    const existing = await supabase.select('customers', `email=eq.${encodeURIComponent(customer.email)}&limit=1`);
    if (existing && existing.length > 0) {
      return supabase.patch('customers', `id=eq.${existing[0].id}`, customer);
    }
  } else if (customer.phone) {
    const existing = await supabase.select('customers', `phone=eq.${encodeURIComponent(customer.phone)}&limit=1`);
    if (existing && existing.length > 0) {
      return supabase.patch('customers', `id=eq.${existing[0].id}`, customer);
    }
  }
  return supabase.insert('customers', customer);
}
