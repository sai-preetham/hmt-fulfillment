import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bookWixOrder, bookWixOrderById, syncBookedShipmentToWix } from './booking.js';
import { getConfig } from './config.js';
import { listCourierServices } from './couriers/index.js';
import { calculateDelhiveryCharge, calculateInternationalCharge } from './delhivery.js';
import { createDelhiveryTrackingSync } from './delhiveryTracking.js';
import { sendJson, sendStatic, sendText, readJsonRequest } from './http.js';
import { buildInternationalShipmentWorkbook, internationalExportFilename } from './internationalExport.js';
import { createShipmentLabel } from './labels.js';
import {
  findLatestShipmentForOrder,
  findOrderById,
  findShipmentById,
  listInternationalExportOrders,
  listDashboardOrders,
  listOrders,
  listShipmentAttempts,
  listShipments,
  markOrderFulfilled,
  updateShipmentLabel,
  upsertShipment,
  upsertWixOrders,
  packOrder,
  logBuyerCall,
  updateShipmentStatus,
  matchesDashboardQueue
} from './store.js';
import { decodeWixEvent, fetchWixOrder, getOrderIdFromWixEvent, searchWixOrders } from './wix.js';
import { createWixOrderSync } from './wixOrderSync.js';

const config = getConfig();
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const wixOrderSync = createWixOrderSync(config);
const trackingSync = createDelhiveryTrackingSync(config);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(config.port, () => {
  console.log(`Wix Delhivery app running at http://localhost:${config.port}`);
  wixOrderSync.start();
  trackingSync.start();
});

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${config.port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      env: config.delhivery.env,
      tracking: trackingSync.snapshot()
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/shipments') {
    return sendJson(res, 200, { shipments: await listShipments() });
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    return sendJson(res, 200, { orders: await listOrders() });
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard/orders') {
    const queue = url.searchParams.get('queue') || 'needs_packing';
    const limit = Number(url.searchParams.get('limit') || 100);
    const allRecent = await listDashboardOrders({
      queue: 'all_recent',
      limit: 200
    });
    const filtered = allRecent.filter(order => matchesDashboardQueue(order, queue)).slice(0, limit);
    return sendJson(res, 200, {
      orders: filtered,
      summary: summarizeDashboardOrders(allRecent),
      sync: wixOrderSync.snapshot()
    });
  }

  if (req.method === 'GET' && matchPath(url.pathname, '/api/dashboard/orders/:id')) {
    const { id } = matchPath(url.pathname, '/api/dashboard/orders/:id');
    const order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    const shipment = await findLatestShipmentForOrder(order);
    const attempts = shipment ? await listShipmentAttempts(shipment.id) : [];
    return sendJson(res, 200, { order, shipment, attempts });
  }

  if (req.method === 'GET' && url.pathname === '/api/international/export') {
    const orderId = url.searchParams.get('orderId');
    const orders = orderId
      ? [await findOrderById(orderId)].filter(Boolean)
      : await listInternationalExportOrders({ limit: url.searchParams.get('limit') || 500 });
    if (!orders.length) return sendJson(res, 404, { error: 'No international orders available for export.' });
    const workbook = buildInternationalShipmentWorkbook(orders, config);
    return sendWorkbook(res, internationalExportFilename(orders), workbook);
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/wix-orders') {
    return sendJson(res, 200, { sync: wixOrderSync.snapshot() });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/wix-orders') {
    return sendJson(res, 202, { sync: await wixOrderSync.run('api') });
  }

  if (req.method === 'GET' && url.pathname === '/api/tracking/sync') {
    return sendJson(res, 200, { tracking: trackingSync.snapshot() });
  }

  if (req.method === 'POST' && url.pathname === '/api/tracking/sync') {
    return sendJson(res, 202, { tracking: await trackingSync.run('api') });
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/fulfilled-orders') {
    return sendJson(res, 202, await syncFulfilledOrders(config));
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/cancelled-orders') {
    return sendJson(res, 202, await syncCancelledOrders(config));
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/orders/:id/refresh-wix')) {
    const { id } = matchPath(url.pathname, '/api/orders/:id/refresh-wix');
    const order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    if (!order.wix_order_id) return sendJson(res, 400, { error: 'No Wix order ID on record.' });
    const fresh = await fetchWixOrder(order.wix_order_id, config);
    const updated = await upsertWixOrders([fresh]);
    return sendJson(res, 200, { order: await findOrderById(id), refreshed: updated.length > 0 });
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/orders/:id/mark-fulfilled')) {
    const { id } = matchPath(url.pathname, '/api/orders/:id/mark-fulfilled');
    const order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    await markOrderFulfilled(id);
    return sendJson(res, 200, { success: true, order: await findOrderById(id) });
  }

  if (req.method === 'GET' && matchPath(url.pathname, '/api/shipments/:waybill/tracking')) {
    const { waybill } = matchPath(url.pathname, '/api/shipments/:waybill/tracking');
    const { SupabaseRestClient, isSupabaseConfigured } = await import('./supabase.js');
    if (!isSupabaseConfigured(config)) return sendJson(res, 503, { error: 'Supabase not configured.' });
    const supabase = new SupabaseRestClient(config);
    const shipments = await supabase.select(
      'shipments',
      `waybill=eq.${encodeURIComponent(waybill)}&limit=1`
    );
    if (!shipments.length) return sendJson(res, 404, { error: 'Shipment not found.' });
    const shipmentId = shipments[0].id;
    const events = await supabase.select(
      'shipment_events',
      `shipment_id=eq.${encodeURIComponent(shipmentId)}&order=occurred_at.desc&limit=100`
    );
    return sendJson(res, 200, { waybill, shipment: shipments[0], events });
  }

  if (req.method === 'GET' && url.pathname === '/api/couriers') {
    return sendJson(res, 200, { couriers: listCourierServices() });
  }

  if (req.method === 'GET' && url.pathname === '/api/wix/orders') {
    const result = await searchWixOrders(
      {
        limit: url.searchParams.get('limit'),
        cursor: url.searchParams.get('cursor'),
        paymentStatus: url.searchParams.get('paymentStatus'),
        fulfillmentStatus: url.searchParams.get('fulfillmentStatus'),
        status: url.searchParams.get('status'),
        archived: parseBooleanParam(url.searchParams.get('archived'))
      },
      config
    );
    const persistedOrders = await upsertWixOrders(result.orders);
    return sendJson(res, 200, { ...result, persistedCount: persistedOrders.length });
  }

  if (req.method === 'GET' && url.pathname === '/api/delhivery/rate') {
    const result = await calculateDelhiveryCharge(
      {
        destinationPincode: url.searchParams.get('pin'),
        weightGrams: Number(url.searchParams.get('weight') || config.defaults.weightGrams),
        mode: url.searchParams.get('mode') || config.defaults.shippingMode,
        status: url.searchParams.get('status') || 'Delivered'
      },
      config
    );
    return sendJson(res, 200, result);
  }

  if (req.method === 'GET' && url.pathname === '/api/delhivery/international-rate') {
    const result = calculateInternationalCharge(
      {
        country: url.searchParams.get('country'),
        weightGrams: Number(url.searchParams.get('weight') || config.defaults.weightGrams),
        service: url.searchParams.get('service')
      },
      config
    );
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/book-from-wix') {
    const body = await readJsonRequest(req);
    if (!body.orderId) return sendJson(res, 400, { error: 'orderId is required.' });
    const result = await bookWixOrderById(body.orderId, config, {
      source: 'manual-wix',
      courierCode: body.courierCode || 'delhivery',
      shippingMode: body.shippingMode,
      internationalService: body.internationalService,
      reverse: body.reverse === true
    });
    return sendJson(res, result.skipped ? 200 : 201, result);
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/orders/:id/book')) {
    const { id } = matchPath(url.pathname, '/api/orders/:id/book');
    const order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    const body = await readJsonRequest(req);
    const result = await bookWixOrder(order.raw_order, config, {
      source: 'dashboard',
      courierCode: body.courierCode || 'delhivery',
      shippingMode: body.shippingMode,
      internationalService: body.internationalService,
      reverse: body.reverse === true
    });
    return sendJson(res, result.skipped ? 200 : 201, { ...result, order: await findOrderById(id) });
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/orders/:id/sync-wix-fulfillment')) {
    const { id } = matchPath(url.pathname, '/api/orders/:id/sync-wix-fulfillment');
    const body = await readJsonRequest(req);
    let order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    if (body.refreshFromWix) {
      if (!order.wix_order_id) return sendJson(res, 400, { error: 'No Wix order ID on record.' });
      const fresh = await fetchWixOrder(order.wix_order_id, config);
      await upsertWixOrders([fresh]);
      order = await findOrderById(id);
      if (order?.fulfillment_status === 'FULFILLED') {
        return sendJson(res, 200, {
          skipped: true,
          reason: 'already-fulfilled-on-wix',
          order,
          shipment: await findLatestShipmentForOrder(order)
        });
      }
    }
    const shipment = await findLatestShipmentForOrder(order);
    if (!shipment?.waybill) return sendJson(res, 400, { error: 'Booked shipment with AWB is required.' });
    await syncBookedShipmentToWix(order, shipment, config);
    return sendJson(res, 200, { order: await findOrderById(id), shipment: await findLatestShipmentForOrder(order) });
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/orders/:id/pack')) {
    const { id } = matchPath(url.pathname, '/api/orders/:id/pack');
    const order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    const task = await packOrder(order.id);
    return sendJson(res, 200, { success: true, task, order: await findOrderById(id) });
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/orders/:id/call-buyer')) {
    const { id } = matchPath(url.pathname, '/api/orders/:id/call-buyer');
    const order = await findOrderById(id);
    if (!order) return sendJson(res, 404, { error: 'Order not found.' });
    const body = await readJsonRequest(req);
    if (!body.callStatus) return sendJson(res, 400, { error: 'callStatus is required.' });
    if (!['answered_confirmed', 'completed', 'no_answer', 'retry', 'wrong_number', 'rejected'].includes(body.callStatus)) {
      return sendJson(res, 400, { error: 'Unsupported callStatus.' });
    }
    await logBuyerCall(order.id, body.callStatus, body.notes);
    return sendJson(res, 200, { success: true, order: await findOrderById(id) });
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/shipments/:id/simulate-status')) {
    const { id } = matchPath(url.pathname, '/api/shipments/:id/simulate-status');
    return updateShipmentStatusRoute(id, req, res);
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/shipments/:id/status')) {
    const { id } = matchPath(url.pathname, '/api/shipments/:id/status');
    return updateShipmentStatusRoute(id, req, res);
  }

  if (req.method === 'POST' && matchPath(url.pathname, '/api/shipments/:id/label')) {
    const { id } = matchPath(url.pathname, '/api/shipments/:id/label');
    const shipment = await findShipmentById(id);
    if (!shipment) return sendJson(res, 404, { error: 'Shipment not found.' });
    try {
      const label = await createShipmentLabel(shipment, config);
      const updated = await updateShipmentLabel(id, label);
      return sendJson(res, 200, { shipment: updated });
    } catch (error) {
      const updated = await updateShipmentLabel(id, {
        label_error: error.message
      });
      return sendJson(res, 400, { error: error.message, shipment: updated });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/book-manual') {
    const body = await readJsonRequest(req);
    const order = body.order || body;
    const result = await bookWixOrder(order, config, {
      source: 'manual-json',
      courierCode: body.courierCode || 'delhivery',
      shippingMode: body.shippingMode,
      internationalService: body.internationalService,
      reverse: body.reverse === true
    });
    return sendJson(res, result.skipped ? 200 : 201, result);
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/wix/orders/created') {
    return handleWixOrderCreated(req, res);
  }

  if (req.method === 'GET' && (await sendStatic(req, res, publicDir))) {
    return;
  }

  sendText(res, 404, 'Not found');
}

async function updateShipmentStatusRoute(id, req, res) {
  const shipment = await findShipmentById(id);
  if (!shipment) return sendJson(res, 404, { error: 'Shipment not found.' });
  const body = await readJsonRequest(req);
  if (!body.status) return sendJson(res, 400, { error: 'status is required.' });
  if (!['booked', 'picked-up', 'dispatched', 'in-transit', 'out-for-delivery', 'delivered', 'failed', 'rto'].includes(body.status)) {
    return sendJson(res, 400, { error: 'Unsupported shipment status.' });
  }
  const updated = await updateShipmentStatus(shipment.id, body.status);
  return sendJson(res, 200, { success: true, shipment: updated });
}

function parseBooleanParam(value) {
  if (value === null || value === '') return undefined;
  return value === 'true';
}

function sendWorkbook(res, filename, body) {
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function matchPath(pathname, pattern) {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index];
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[index]);
    } else if (part !== pathParts[index]) {
      return null;
    }
  }
  return params;
}

function summarizeDashboardOrders(orders) {
  return {
    needsPacking: orders.filter(order => matchesDashboardQueue(order, 'needs_packing')).length,
    needsBooking: orders.filter(order => matchesDashboardQueue(order, 'needs_booking')).length,
    readyForPickup: orders.filter(order => matchesDashboardQueue(order, 'ready_for_pickup')).length,
    inTransit: orders.filter(order => matchesDashboardQueue(order, 'in_transit')).length,
    needsCall: orders.filter(order => matchesDashboardQueue(order, 'needs_call')).length,
    completed: orders.filter(order => matchesDashboardQueue(order, 'completed')).length,
    failed: orders.filter(order => matchesDashboardQueue(order, 'failed')).length,
    wixSyncFailed: orders.filter(order => matchesDashboardQueue(order, 'wix_update_failed')).length,
    cancelled: orders.filter(order => matchesDashboardQueue(order, 'cancelled')).length
  };
}

async function handleWixOrderCreated(req, res) {
  const body = await readJsonRequest(req);
  const decoded = decodeWixEvent(body, config);
  const payload = decoded.payload || body;
  const eventId = payload?.id || payload?.eventId || '';
  const order = body.order || payload.order;
  const orderId = order?.id || getOrderIdFromWixEvent(payload);

  if (!orderId) {
    return sendJson(res, 400, { error: 'Could not find Wix order ID in webhook payload.' });
  }

  await upsertShipment({
    eventId,
    orderId: String(orderId),
    source: 'wix-webhook',
    status: config.autoBookWixWebhooks ? 'received' : 'received-not-booked',
    webhookVerified: decoded.verified,
    webhookPayload: payload
  });

  if (!config.autoBookWixWebhooks) {
    return sendJson(res, 202, {
      accepted: true,
      booked: false,
      orderId,
      message: 'Webhook stored. Set AUTO_BOOK_WIX_WEBHOOKS=true to book automatically.'
    });
  }

  const result = order
    ? await bookWixOrder(order, config, { eventId, source: 'wix-webhook', webhookVerified: decoded.verified })
    : await bookWixOrderById(orderId, config, {
        eventId,
        source: 'wix-webhook',
        webhookVerified: decoded.verified
      });

  sendJson(res, result.skipped ? 200 : 201, { accepted: true, booked: !result.skipped, ...result });
}

/**
 * Fetch all FULFILLED orders from Wix and upsert them into the DB.
 * This updates fulfillment_status so they drop out of the needs_packing queue.
 */
async function syncFulfilledOrders(config) {
  if (!config.wix.authToken || !config.wix.siteId) {
    return { skipped: true, reason: 'missing-wix-config', pulled: 0, persisted: 0 };
  }

  let pulled = 0;
  let persisted = 0;
  let pages = 0;
  let cursor = '';

  do {
    pages += 1;
    const result = await searchWixOrders(
      {
        limit: 100,
        cursor,
        fulfillmentStatus: 'FULFILLED',
        sortField: 'updatedDate',
        sortOrder: 'DESC'
      },
      config
    );
    const orders = result.orders || [];
    const saved = await upsertWixOrders(orders);
    pulled += orders.length;
    persisted += saved.length;
    cursor = result.pagingMetadata?.cursors?.next || '';
  } while (cursor && pages < 20);

  return { pulled, persisted, pages };
}

/**
 * Fetch all CANCELED orders from Wix and upsert them into the DB.
 * This updates their status field so they are excluded from all active queues.
 */
async function syncCancelledOrders(config) {
  if (!config.wix.authToken || !config.wix.siteId) {
    return { skipped: true, reason: 'missing-wix-config', pulled: 0, persisted: 0 };
  }

  let pulled = 0;
  let persisted = 0;
  let pages = 0;
  let cursor = '';

  do {
    pages += 1;
    const result = await searchWixOrders(
      {
        limit: 100,
        cursor,
        status: 'CANCELED',
        sortField: 'updatedDate',
        sortOrder: 'DESC'
      },
      config
    );
    const orders = result.orders || [];
    const saved = await upsertWixOrders(orders);
    pulled += orders.length;
    persisted += saved.length;
    cursor = result.pagingMetadata?.cursors?.next || '';
  } while (cursor && pages < 20);

  return { pulled, persisted, pages };
}
