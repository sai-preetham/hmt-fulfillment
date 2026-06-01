import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bookWixOrder, bookWixOrderById } from './booking.js';
import { getConfig } from './config.js';
import { listCourierServices } from './couriers/index.js';
import { calculateDelhiveryCharge, calculateInternationalCharge } from './delhivery.js';
import { sendJson, sendStatic, sendText, readJsonRequest } from './http.js';
import { listOrders, listShipments, upsertShipment, upsertWixOrders } from './store.js';
import { decodeWixEvent, getOrderIdFromWixEvent, searchWixOrders } from './wix.js';

const config = getConfig();
const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(config.port, () => {
  console.log(`Wix Delhivery app running at http://localhost:${config.port}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${config.port}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, env: config.delhivery.env });
  }

  if (req.method === 'GET' && url.pathname === '/api/shipments') {
    return sendJson(res, 200, { shipments: await listShipments() });
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    return sendJson(res, 200, { orders: await listOrders() });
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

function parseBooleanParam(value) {
  if (value === null || value === '') return undefined;
  return value === 'true';
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
