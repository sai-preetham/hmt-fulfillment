import { createServiceClient } from '../supabase/server.js';
import { applyCrmSettingsToConfig } from './settings.js';
import { sendChatwootTrackingMessage } from './chatwoot.js';

const RETRY_LIMIT = 3;
const ACTIVE_TRACKING_STATUSES = new Set(['booked', 'shipment-booked', 'pickup-pending', 'picked-up', 'dispatched', 'in-transit', 'out-for-delivery']);
const TERMINAL_ORDER_STATUSES = new Set(['cancelled', 'not-paid', 'fulfilled-no-tracking', 'completed']);

let inMemoryRunState = {
  running: false,
  lastRun: null,
  lastResult: null
};

export function selectAutomationLane(order) {
  if (shouldSkipAutomation(order)) return { lane: 'skip', reason: skipReason(order) };
  if (hasAwb(order)) return { lane: 'post_awb', courier: order.courier || order.shipment_courier_code || 'delhivery' };
  if (isInternationalOrder(order)) {
    const shipping = shippingMethodText(order);
    if (shipping.includes('express')) return { lane: 'fedex_csv', courier: 'fedex', serviceCode: 'international_express' };
    return { lane: 'book_dlh_dlv_saver', courier: 'delhivery', serviceCode: 'dlv_saver', internationalService: 'DLV Saver' };
  }
  return { lane: 'book_dlh_express', courier: 'delhivery', serviceCode: 'express', shippingMode: 'E' };
}

export function shouldSkipAutomation(order) {
  return Boolean(skipReason(order));
}

export function skipReason(order) {
  if (!order) return 'missing-order';
  if (order.automation_hold) return 'automation-hold';
  if (!isPaidOrder(order)) return 'unpaid';
  if (TERMINAL_ORDER_STATUSES.has(normalizeStatus(order.internal_status))) return 'terminal-status';
  if (normalizeStatus(order.status) === 'canceled' || normalizeStatus(order.status) === 'cancelled') return 'cancelled';
  return '';
}

export function isPaidOrder(order) {
  return ['paid', 'approved'].includes(normalizeStatus(order.payment_status));
}

export async function runAutomationCycle({ trigger = 'manual', force = false } = {}) {
  if (inMemoryRunState.running) return { ok: true, skipped: true, reason: 'already-running', state: inMemoryRunState };
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: 'Supabase service client is not configured.' };

  inMemoryRunState = { ...inMemoryRunState, running: true };
  const startedAt = new Date().toISOString();
  const counters = emptyCounters();
  const errors = [];
  const run = await createAutomationRun(supabase, trigger, startedAt);

  try {
    await runWixSync(counters, errors, force);
    const settings = await loadSettings(supabase);
    const { getConfig } = await import('../../src/config.js');
    const config = applyCrmSettingsToConfig(getConfig(), settings);
    const orders = await listAutomationOrders(supabase);
    counters.checked = orders.length;

    for (const order of orders) {
      try {
        await processOrder(supabase, order, config, counters);
      } catch (error) {
        errors.push(`${order.order_number || order.id}: ${error.message}`);
        counters.failed += 1;
        await failOrder(supabase, order, 'automation', error.message, { trigger });
      }
    }

    await runTrackingPoll(config, counters, errors);
  } catch (error) {
    errors.push(error.message);
  }

  const status = errors.length ? (counters.processed > 0 ? 'partial' : 'failed') : 'success';
  const result = {
    ok: status !== 'failed',
    trigger,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    counters,
    errors: errors.slice(0, 20)
  };
  await finishAutomationRun(supabase, run?.id, result);
  inMemoryRunState = { running: false, lastRun: result.finishedAt, lastResult: result };
  return result;
}

export async function getAutomationDashboardData() {
  const supabase = createServiceClient();
  if (!supabase) {
    return {
      ok: false,
      error: 'Supabase service client is not configured.',
      state: inMemoryRunState,
      queues: emptyQueues(),
      runs: [],
      errors: [],
      fedexBatches: []
    };
  }

  const [runs, orders, errors, batches] = await Promise.all([
    safeSelect(supabase.from('automation_runs').select('*').order('started_at', { ascending: false }).limit(10), []),
    listAutomationOrders(supabase, 250),
    safeSelect(supabase.from('integration_errors').select('*').eq('status', 'open').order('occurred_at', { ascending: false }).limit(20), []),
    safeSelect(supabase.from('fedex_export_batches').select('*, fedex_export_items(*)').order('created_at', { ascending: false }).limit(8), [])
  ]);

  return {
    ok: true,
    state: inMemoryRunState,
    lastRun: runs[0] || null,
    runs,
    queues: summarizeQueues(orders),
    errors,
    fedexBatches: batches,
    nextRunHint: nextRunHint(runs[0]?.finished_at || runs[0]?.started_at)
  };
}

export async function syncOrderTrackingSideEffects(orderId, { reason = 'manual-awb' } = {}) {
  const supabase = createServiceClient();
  if (!supabase || !orderId) return { ok: false, skipped: true, reason: 'missing-supabase-or-order' };
  const [order, shipment] = await Promise.all([
    getAutomationOrder(supabase, orderId),
    latestShipmentForOrder(supabase, orderId)
  ]);
  if (!order) return { ok: false, error: 'Order not found.' };
  if (!shipment?.waybill && !order.awb_number && !order.shipment_waybill) return { ok: true, skipped: true, reason: 'missing-awb' };
  const settings = await loadSettings(supabase);
  const { getConfig } = await import('../../src/config.js');
  const config = applyCrmSettingsToConfig(getConfig(), settings);
  const mergedShipment = {
    ...shipment,
    waybill: shipment?.waybill || order.awb_number || order.shipment_waybill,
    courier_code: shipment?.courier_code || order.courier || order.shipment_courier_code || 'delhivery',
    status: shipment?.status || order.shipment_status || 'booked'
  };

  const counters = emptyCounters();
  await syncWixAndMessage(supabase, order, mergedShipment, config, counters, reason);
  return { ok: true, counters };
}

export async function exportFedexBatchCsv(batchId) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: 'Supabase service client is not configured.' };
  const { data: batch, error } = await supabase
    .from('fedex_export_batches')
    .select('*, fedex_export_items(*, orders(*, customers(*), shipping_address:customer_addresses!orders_shipping_address_id_fkey(*)))')
    .eq('id', batchId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!batch) return { ok: false, error: 'FedEx batch not found.' };

  const rows = (batch.fedex_export_items || []).map(item => fedexCsvRow(item.orders || {}, item.csv_payload || {}));
  const csv = toCsv([
    ['Order Number', 'Customer Name', 'Phone', 'Email', 'Address 1', 'Address 2', 'City', 'State', 'Postal Code', 'Country', 'Weight Grams', 'Length Cm', 'Width Cm', 'Height Cm', 'Declared Value'],
    ...rows
  ]);
  await supabase.from('fedex_export_batches').update({ status: 'exported', exported_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', batch.id);
  return { ok: true, filename: `${batch.batch_number}.csv`, csv };
}

async function processOrder(supabase, order, config, counters) {
  const lane = selectAutomationLane(order);
  if (lane.lane === 'skip') {
    counters.skipped += 1;
    await markOrderAutomation(supabase, order.id, `skipped:${lane.reason}`, null);
    return;
  }
  counters.processed += 1;

  if (lane.lane === 'post_awb') {
    const shipment = await latestShipmentForOrder(supabase, order.id);
    await syncWixAndMessage(supabase, order, shipment || orderToShipment(order), config, counters, 'post-awb');
    await markOrderAutomation(supabase, order.id, 'post-awb-complete', null);
    return;
  }

  if (lane.lane === 'fedex_csv') {
    await addOrderToFedexBatch(supabase, order);
    counters.fedexQueued += 1;
    await markOrderAutomation(supabase, order.id, 'awaiting-fedex-awb', null, {
      internal_status: 'awaiting_fedex_awb',
      shipment_status: 'awaiting_fedex_awb',
      courier: 'fedex'
    });
    return;
  }

  await bookAutomationShipment(supabase, order, lane, config, counters);
}

async function bookAutomationShipment(supabase, order, lane, config, counters) {
  const attemptState = await getAttemptState(supabase, order.id, 'courier-booking');
  if (attemptState.attempts >= RETRY_LIMIT && attemptState.status !== 'success') {
    counters.blocked += 1;
    await failOrder(supabase, order, 'courier-booking', 'Courier booking retry limit reached.', { lane });
    return;
  }

  await recordAttempt(supabase, {
    orderId: order.id,
    actionType: 'courier-booking',
    status: 'running',
    payload: { lane }
  });

  try {
    const { bookWixOrder, bookWixOrderById } = await import('../../src/booking.js');
    const result = order.raw_order
      ? await bookWixOrder(order.raw_order, config, {
          source: 'automation',
          courierCode: lane.courier,
          shippingMode: lane.shippingMode,
          internationalService: lane.internationalService,
          serviceCode: lane.serviceCode
        })
      : await bookWixOrderById(order.wix_order_id || order.external_order_id, config, {
          source: 'automation',
          courierCode: lane.courier,
          shippingMode: lane.shippingMode,
          internationalService: lane.internationalService,
          serviceCode: lane.serviceCode
        });

    const shipment = result.shipment || {};
    counters.booked += shipment.waybill ? 1 : 0;
    counters.queued += shipment.waybill ? 0 : 1;
    await recordAttempt(supabase, {
      orderId: order.id,
      actionType: 'courier-booking',
      status: 'success',
      payload: { lane, result: compactShipmentResult(shipment) }
    });
    await markOrderAutomation(supabase, order.id, shipment.waybill ? 'booked' : 'queued', null);
    if (shipment.waybill) {
      await syncWixAndMessage(supabase, order, shipment, config, counters, 'auto-booking');
    }
  } catch (error) {
    await recordAttempt(supabase, {
      orderId: order.id,
      actionType: 'courier-booking',
      status: 'failed',
      error: error.message,
      payload: { lane }
    });
    if ((attemptState.attempts + 1) >= RETRY_LIMIT) {
      await failOrder(supabase, order, 'courier-booking', error.message, { lane });
    } else {
      await markOrderAutomation(supabase, order.id, 'booking-retry-pending', error.message);
    }
    throw error;
  }
}

async function syncWixAndMessage(supabase, order, shipment, config, counters, reason) {
  const waybill = shipment?.waybill || order.awb_number || order.shipment_waybill;
  if (!waybill) return;

  const wixAttempt = await getAttemptState(supabase, order.id, 'wix-fulfillment');
  if (wixAttempt.attempts < RETRY_LIMIT || wixAttempt.status === 'success') {
    try {
      await recordAttempt(supabase, { orderId: order.id, shipmentId: shipment.id, actionType: 'wix-fulfillment', status: 'running', payload: { reason } });
      const { syncShipmentTrackingToWix } = await import('../../src/wixShipmentSync.js');
      await syncShipmentTrackingToWix(
        {
          ...order,
          wix_fulfillment_id: order.wix_fulfillment_id || shipment.wix_fulfillment_id || ''
        },
        {
          ...shipment,
          waybill,
          status: shipment.status || order.shipment_status || 'booked'
        },
        config
      );
      counters.wixUpdated += 1;
      await recordAttempt(supabase, { orderId: order.id, shipmentId: shipment.id, actionType: 'wix-fulfillment', status: 'success', payload: { reason, waybill } });
    } catch (error) {
      await recordAttempt(supabase, { orderId: order.id, shipmentId: shipment.id, actionType: 'wix-fulfillment', status: 'failed', error: error.message, payload: { reason, waybill } });
      if ((wixAttempt.attempts + 1) >= RETRY_LIMIT) await failOrder(supabase, order, 'wix-fulfillment', error.message, { waybill });
    }
  }

  await sendTrackingMessageOnce(supabase, order, { ...shipment, waybill }, counters);
}

async function sendTrackingMessageOnce(supabase, order, shipment, counters) {
  const existing = await safeMaybeSingle(
    supabase.from('customer_messages').select('*').eq('order_id', order.id).eq('message_type', 'tracking-link').eq('channel', 'chatwoot')
  );
  if (existing?.status === 'sent') return;
  if (existing?.attempts >= RETRY_LIMIT && existing.status !== 'sent') {
    counters.blocked += 1;
    await failOrder(supabase, order, 'chatwoot-tracking', 'Chatwoot tracking message retry limit reached.', { waybill: shipment.waybill });
    return;
  }

  try {
    const result = await sendChatwootTrackingMessage(order, shipment);
    const status = result.skipped ? 'skipped' : 'sent';
    await upsertCustomerMessage(supabase, order, shipment, {
      status,
      attempts: (existing?.attempts || 0) + 1,
      providerMessageId: result.providerMessageId || '',
      content: result.content,
      error: result.reason || null
    });
    await updateOrderCustomerMessage(supabase, order.id, status, result.reason || null);
    counters.messagesSent += status === 'sent' ? 1 : 0;
    counters.messagesSkipped += status === 'skipped' ? 1 : 0;
  } catch (error) {
    await upsertCustomerMessage(supabase, order, shipment, {
      status: 'failed',
      attempts: (existing?.attempts || 0) + 1,
      error: error.message
    });
    await updateOrderCustomerMessage(supabase, order.id, 'failed', error.message);
    if (((existing?.attempts || 0) + 1) >= RETRY_LIMIT) {
      await failOrder(supabase, order, 'chatwoot-tracking', error.message, { waybill: shipment.waybill });
    }
  }
}

async function runWixSync(counters, errors, force) {
  try {
    const { runWixOrderSync } = await import('./wix-sync.js');
    const result = await runWixOrderSync({ reason: 'automation', force });
    counters.wixPulled = result.pulled || 0;
    counters.wixPersisted = result.persisted || 0;
    if (!result.ok) errors.push(result.error || 'Wix sync failed.');
  } catch (error) {
    errors.push(error.message);
  }
}

async function runTrackingPoll(config, counters, errors) {
  try {
    const { createDelhiveryTrackingSync } = await import('../../src/delhiveryTracking.js');
    const sync = createDelhiveryTrackingSync(
      {
        ...config,
        delhivery: {
          ...config.delhivery,
          trackingEnabled: true
        }
      },
      {
        setTimer: () => null,
        clearTimer: () => null
      }
    );
    const result = await sync.run('automation');
    counters.trackingPolled = result.lastPolled || 0;
    counters.trackingUpdated = result.lastUpdated || 0;
    counters.trackingEvents = result.lastEvents || 0;
    if (result.lastError && !result.skipped) errors.push(result.lastError);
  } catch (error) {
    errors.push(error.message);
  }
}

async function addOrderToFedexBatch(supabase, order) {
  const existing = await safeMaybeSingle(supabase.from('fedex_export_items').select('*').eq('order_id', order.id));
  if (existing) return existing;
  const batch = await getOpenFedexBatch(supabase);
  const payload = fedexPayload(order);
  const { data, error } = await supabase
    .from('fedex_export_items')
    .insert({
      batch_id: batch.id,
      order_id: order.id,
      status: 'pending_awb',
      csv_payload: payload
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getOpenFedexBatch(supabase) {
  const existing = await safeMaybeSingle(
    supabase.from('fedex_export_batches').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(1)
  );
  if (existing) return existing;
  const batchNumber = `fedex-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;
  const { data, error } = await supabase.from('fedex_export_batches').insert({ batch_number: batchNumber }).select().single();
  if (error) throw error;
  return data;
}

async function listAutomationOrders(supabase, limit = 100) {
  const query = supabase
    .from('orders')
    .select(`
      id,wix_order_id,external_order_id,order_number,status,payment_status,fulfillment_status,internal_status,
      shipment_status,shipment_waybill,shipment_courier_code,shipment_service_code,shipment_service_mode,
      wix_fulfillment_status,wix_fulfillment_id,wix_fulfillment_error,
      source,total_amount,currency,selected_shipping_title,raw_order,courier,awb_number,tracking_url,
      automation_hold,automation_hold_reason,last_automation_status,last_automation_error,
      customer_message_status,customer_message_error,chatwoot_conversation_id,
      package_weight_grams,package_length_cm,package_width_cm,package_height_cm,
      source_created_at,updated_at,
      customers(name,email,phone),
      shipping_address:customer_addresses!orders_shipping_address_id_fkey(name,phone,address_line1,address_line2,city,state,postal_code,country)
    `)
    .order('source_created_at', { ascending: false })
    .limit(limit);
  return safeSelect(query, []);
}

async function getAutomationOrder(supabase, orderId) {
  const rows = await safeSelect(supabase.from('orders').select('*').eq('id', orderId).limit(1), []);
  return rows[0] || null;
}

async function latestShipmentForOrder(supabase, orderId) {
  const rows = await safeSelect(
    supabase.from('shipments').select('*').eq('order_id', orderId).order('updated_at', { ascending: false }).limit(1),
    []
  );
  return rows[0] || null;
}

async function loadSettings(supabase) {
  const rows = await safeSelect(supabase.from('crm_settings').select('key,value'), []);
  return rows.reduce((settings, row) => ({ ...settings, [row.key]: row.value }), {});
}

async function createAutomationRun(supabase, trigger, startedAt) {
  const { data } = await supabase.from('automation_runs').insert({ trigger, started_at: startedAt }).select().single();
  return data || null;
}

async function finishAutomationRun(supabase, runId, result) {
  if (!runId) return;
  await supabase
    .from('automation_runs')
    .update({
      status: result.status,
      finished_at: result.finishedAt,
      counters: result.counters,
      error_summary: result.errors?.join('\n') || null,
      raw_result: result
    })
    .eq('id', runId);
}

async function recordAttempt(supabase, { orderId, shipmentId = null, actionType, status, error = null, payload = {} }) {
  const actionKey = `${actionType}:${orderId || 'global'}`;
  const existing = await safeMaybeSingle(supabase.from('automation_action_attempts').select('*').eq('action_key', actionKey));
  const attempts = status === 'running' ? existing?.attempts || 0 : (existing?.attempts || 0) + (status === 'failed' ? 1 : 0);
  const row = {
    action_key: actionKey,
    action_type: actionType,
    order_id: orderId || null,
    shipment_id: shipmentId,
    status,
    attempts,
    last_error: error,
    payload,
    updated_at: new Date().toISOString()
  };
  const { data } = await supabase.from('automation_action_attempts').upsert(row, { onConflict: 'action_key' }).select().single();
  return data || row;
}

async function getAttemptState(supabase, orderId, actionType) {
  const existing = await safeMaybeSingle(supabase.from('automation_action_attempts').select('*').eq('action_key', `${actionType}:${orderId}`));
  return existing || { attempts: 0, status: 'pending' };
}

async function failOrder(supabase, order, operation, message, payload = {}) {
  await markOrderAutomation(supabase, order.id, `${operation}-failed`, message);
  await supabase.from('integration_errors').insert({
    integration: operation.includes('wix') ? 'wix' : operation.includes('chatwoot') ? 'chatwoot' : operation.includes('courier') ? 'courier' : 'automation',
    operation,
    status: 'open',
    message,
    payload: {
      orderId: order.id,
      orderNumber: order.order_number,
      ...payload
    }
  });
  const title = `Automation failed: ${operation}`;
  const existing = await safeMaybeSingle(
    supabase.from('tasks').select('*').eq('order_id', order.id).eq('title', title).in('status', ['open', 'in_progress', 'blocked']).limit(1)
  );
  const taskPayload = {
    title,
    order_id: order.id,
    priority: 'high',
    status: 'open',
    notes: message,
    assigned_operator: 'Operations',
    updated_at: new Date().toISOString()
  };
  if (existing?.id) {
    await supabase.from('tasks').update(taskPayload).eq('id', existing.id);
  } else {
    await supabase.from('tasks').insert(taskPayload);
  }
}

async function markOrderAutomation(supabase, orderId, status, error, extra = {}) {
  await supabase
    .from('orders')
    .update({
      ...extra,
      last_automation_status: status,
      last_automation_error: error,
      last_automation_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);
}

async function upsertCustomerMessage(supabase, order, shipment, fields) {
  await supabase.from('customer_messages').upsert(
    {
      order_id: order.id,
      shipment_id: shipment.id || null,
      message_type: 'tracking-link',
      channel: 'chatwoot',
      status: fields.status,
      attempts: fields.attempts,
      recipient_ref: order.chatwoot_conversation_id || '',
      provider_message_id: fields.providerMessageId || '',
      content: fields.content || null,
      error: fields.error || null,
      sent_at: fields.status === 'sent' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'order_id,message_type,channel' }
  );
}

async function updateOrderCustomerMessage(supabase, orderId, status, error) {
  await supabase
    .from('orders')
    .update({
      customer_message_status: status,
      customer_message_error: error,
      customer_message_sent_at: status === 'sent' ? new Date().toISOString() : null,
      last_message_type: 'tracking-link',
      last_communication_at: status === 'sent' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);
}

function summarizeQueues(orders) {
  const queues = emptyQueues();
  for (const order of orders) {
    const lane = selectAutomationLane(order);
    if (order.automation_hold) queues.manualHolds += 1;
    if (lane.lane === 'book_dlh_express' || lane.lane === 'book_dlh_dlv_saver') queues.readyToBook += 1;
    if (lane.lane === 'fedex_csv') queues.fedexPending += 1;
    if (normalizeStatus(order.internal_status) === 'awaiting_fedex_awb') queues.awaitingFedexAwb += 1;
    if (order.wix_fulfillment_status === 'failed' || order.wix_fulfillment_error) queues.wixFailed += 1;
    if (order.customer_message_status === 'failed') queues.chatwootFailed += 1;
    if (String(order.last_automation_status || '').includes('courier-booking-failed')) queues.courierFailed += 1;
    if (ACTIVE_TRACKING_STATUSES.has(normalizeStatus(order.shipment_status))) queues.activeTracking += 1;
    if (order.last_automation_error) queues.blockedValidation += 1;
  }
  return queues;
}

function emptyQueues() {
  return {
    readyToBook: 0,
    blockedValidation: 0,
    fedexPending: 0,
    awaitingFedexAwb: 0,
    wixFailed: 0,
    chatwootFailed: 0,
    courierFailed: 0,
    activeTracking: 0,
    manualHolds: 0
  };
}

function emptyCounters() {
  return {
    wixPulled: 0,
    wixPersisted: 0,
    checked: 0,
    processed: 0,
    skipped: 0,
    booked: 0,
    queued: 0,
    fedexQueued: 0,
    wixUpdated: 0,
    messagesSent: 0,
    messagesSkipped: 0,
    trackingPolled: 0,
    trackingUpdated: 0,
    trackingEvents: 0,
    blocked: 0,
    failed: 0
  };
}

function hasAwb(order) {
  return Boolean(order.awb_number || order.shipment_waybill);
}

function isInternationalOrder(order) {
  const country =
    order.shipping_address?.country ||
    order.raw_order?.shippingInfo?.logistics?.shippingDestination?.address?.country ||
    order.raw_order?.billingInfo?.address?.country ||
    'IN';
  return String(country || 'IN').toUpperCase() !== 'IN';
}

function shippingMethodText(order) {
  return String(
    order.selected_shipping_title ||
      order.raw_order?.shippingInfo?.title ||
      order.raw_order?.shippingInfo?.logistics?.selectedCarrierServiceOption?.title ||
      order.raw_order?.shippingInfo?.code ||
      ''
  ).toLowerCase();
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase().replace(/_/g, '-');
}

function orderToShipment(order) {
  return {
    order_id: order.id,
    waybill: order.awb_number || order.shipment_waybill,
    courier_code: order.courier || order.shipment_courier_code || 'delhivery',
    status: order.shipment_status || 'booked'
  };
}

function compactShipmentResult(shipment) {
  return {
    id: shipment.id,
    status: shipment.status,
    waybill: shipment.waybill,
    courier_code: shipment.courier_code,
    message: shipment.message
  };
}

function fedexPayload(order) {
  const address = order.shipping_address || {};
  const customer = order.customers || {};
  return {
    orderNumber: order.order_number || order.external_order_id || order.wix_order_id,
    customerName: address.name || customer.name || '',
    phone: address.phone || customer.phone || '',
    email: customer.email || order.raw_order?.buyerInfo?.email || '',
    addressLine1: address.address_line1 || '',
    addressLine2: address.address_line2 || '',
    city: address.city || '',
    state: address.state || '',
    postalCode: address.postal_code || '',
    country: address.country || '',
    weightGrams: order.package_weight_grams || 400,
    lengthCm: order.package_length_cm || 23,
    widthCm: order.package_width_cm || 15,
    heightCm: order.package_height_cm || 6,
    declaredValue: order.total_amount || 0
  };
}

function fedexCsvRow(order, payload) {
  const merged = {
    ...fedexPayload(order),
    ...payload
  };
  return [
    merged.orderNumber,
    merged.customerName,
    merged.phone,
    merged.email,
    merged.addressLine1,
    merged.addressLine2,
    merged.city,
    merged.state,
    merged.postalCode,
    merged.country,
    merged.weightGrams,
    merged.lengthCm,
    merged.widthCm,
    merged.heightCm,
    merged.declaredValue
  ];
}

function toCsv(rows) {
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function nextRunHint(value) {
  const timestamp = value ? Date.parse(value) : Date.now();
  return new Date(timestamp + 15 * 60_000).toISOString();
}

async function safeSelect(query, fallback) {
  const { data, error } = await query;
  if (error) return fallback;
  return data || fallback;
}

async function safeMaybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data || null;
}
