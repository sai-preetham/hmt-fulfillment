import { getCourierAdapter } from './couriers/index.js';
import { findShipmentByOrderId, updateOrderWixFulfillment, upsertShipment, upsertWixOrder } from './store.js';
import { createWixFulfillment } from './wixFulfillment.js';
import { fetchWixOrder } from './wix.js';

export async function bookWixOrder(order, config, metadata = {}) {
  const orderId = order?.id || order?.number;
  if (!orderId) throw new Error('Order is missing id/number.');

  const existing = await findShipmentByOrderId(String(orderId));
  if (existing?.status === 'booked') {
    return { shipment: existing, skipped: true };
  }

  const persistedOrder = await upsertWixOrder(order);
  const bookingConfig = withShippingMode(config, metadata.shippingMode);
  const courier = getCourierAdapter(metadata.courierCode || 'delhivery');
  const payload = courier.mapOrder(order, bookingConfig, {
    internationalService: metadata.internationalService,
    reverse: metadata.reverse
  });
  const pending = await upsertShipment({
    ...metadata,
    dbOrderId: persistedOrder?.id,
    orderId: String(orderId),
    orderNumber: order?.number || '',
    courierCode: courier.code,
    status: bookingConfig.createAwbOnBook ? 'pending' : 'pending-zone',
    requestPayload: payload
  });

  if (!bookingConfig.createAwbOnBook) {
    return {
      shipment: {
        ...pending,
        message:
          payload.flow === 'international'
            ? `International order queued pending. Delhivery service: ${payload.shipment.service}. AWB creation is disabled.`
            : 'Queued pending. AWB creation is disabled by CREATE_AWB_ON_BOOK=false.'
      },
      skipped: false
    };
  }

  if (payload.flow === 'international') {
    const queued = await upsertShipment({
      ...pending,
      status: 'pending-international',
      error: '',
      delhiveryResponse: null,
      waybill: '',
      message:
        'International order queued. Domestic CMU API cannot create this AWB; configure Delhivery international API endpoint/schema to manifest it.'
    });
    return { shipment: queued, skipped: false };
  }

  try {
    const delhiveryResponse = await courier.createShipment(payload, bookingConfig);
    const booked = await upsertShipment({
      ...pending,
      status: 'booked',
      delhiveryResponse,
      waybill: extractWaybill(delhiveryResponse),
      error: ''
    });
    await syncBookedShipmentToWix(persistedOrder, booked, bookingConfig);
    return { shipment: booked, skipped: false };
  } catch (error) {
    const failed = await upsertShipment({
      ...pending,
      status: 'failed',
      error: error.message
    });
    throw Object.assign(error, { shipment: failed });
  }
}

export async function syncBookedShipmentToWix(order, shipment, config) {
  if (!order?.id || !shipment?.waybill) return null;
  await updateOrderWixFulfillment(order.id, {
    status: 'pending',
    error: null
  });

  try {
    const result = await createWixFulfillment(order, normalizeShipmentForWix(shipment), config);
    if (result.skipped) {
      return updateOrderWixFulfillment(order.id, {
        status: result.status,
        error: null
      });
    }
    return updateOrderWixFulfillment(order.id, {
      status: 'synced',
      fulfillmentId: result.fulfillmentId,
      syncedAt: new Date().toISOString(),
      error: null
    });
  } catch (error) {
    return updateOrderWixFulfillment(order.id, {
      status: 'failed',
      error: error.message
    });
  }
}

export async function bookWixOrderById(orderId, config, metadata = {}) {
  const order = await fetchWixOrder(orderId, config);
  return bookWixOrder(order, config, metadata);
}

function withShippingMode(config, shippingMode) {
  if (!shippingMode) return config;
  const normalized = normalizeShippingMode(shippingMode);
  return {
    ...config,
    defaults: {
      ...config.defaults,
      shippingMode: normalized
    }
  };
}

function normalizeShippingMode(value) {
  const normalized = String(value).trim().toLowerCase();
  if (['s', 'surface'].includes(normalized)) return 'S';
  return 'E';
}

function extractWaybill(response) {
  return (
    response?.packages?.[0]?.waybill ||
    response?.packages?.[0]?.waybill_number ||
    response?.waybill ||
    response?.upload_wbn ||
    ''
  );
}

function normalizeShipmentForWix(shipment) {
  return {
    waybill: shipment.waybill,
    courier_code: shipment.source || 'delhivery',
    courier_service_code: shipment.shippingMode === 'S' ? 'surface' : 'express',
    service_mode:
      shipment.internationalService ||
      (shipment.shippingMode === 'S' ? 'Surface' : 'Express')
  };
}
