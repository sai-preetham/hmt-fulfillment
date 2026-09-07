import { getCourierAdapter } from './couriers/index.js';
import { findShipmentByOrderId, updateOrderWixFulfillment, upsertShipment, upsertWixOrder, upsertAmazonOrder, findOrderById } from './store.js';
import { updateWixFulfillmentTracking } from './wixFulfillment.js';
import { fetchWixOrder } from './wix.js';

export async function bookWixOrder(order, config, metadata = {}) {
  const orderId = order?.id || order?.number;
  if (!orderId) throw new Error('Order is missing id/number.');

  const existing = await findShipmentByOrderId(String(orderId));
  if (existing?.status === 'booked' && !metadata.allowMultipleShipments) {
    return { shipment: existing, skipped: true };
  }

  const persistedOrder = await upsertWixOrder(order);
  const bookingConfig = withShippingMode(config, metadata.shippingMode);
  const courier = getCourierAdapter(metadata.courierCode || 'delhivery');
  const payload = courier.mapOrder(order, bookingConfig, {
    internationalService: metadata.internationalService,
    reverse: metadata.reverse,
    orderNumberOverride: metadata.orderNumberOverride,
    deliveryOverride: metadata.deliveryOverride
  });
  const pending = await upsertShipment({
    ...metadata,
    createNewShipment: metadata.allowMultipleShipments,
    dbOrderId: persistedOrder?.id,
    orderId: String(orderId),
    orderNumber: payload.shipments?.[0]?.order || metadata.orderNumberOverride || order?.number || '',
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

  if (payload.flow === 'international' && courier.code !== 'fedex') {
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

  // Replacement / already-fulfilled orders: refresh tracking on the existing
  // Wix fulfillment only. Never create a new fulfillment at booking time.
  if (order.wix_fulfillment_id) {
    await updateOrderWixFulfillment(order.id, {
      status: 'pending',
      error: null
    });
    try {
      const result = await updateWixFulfillmentTracking(
        order,
        order.wix_fulfillment_id,
        normalizeShipmentForWix(shipment),
        config
      );
      if (result.skipped) {
        return updateOrderWixFulfillment(order.id, {
          status: result.status,
          error: null
        });
      }
      return updateOrderWixFulfillment(order.id, {
        status: 'synced',
        fulfillmentId: result.fulfillmentId || order.wix_fulfillment_id,
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

  // New AWB booking: keep tracking in Ops/Chatwoot, but leave Wix unfulfilled
  // until the courier confirms warehouse pickup (or later).
  return updateOrderWixFulfillment(order.id, {
    status: 'awaiting-pickup',
    error: null
  });
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
    response?.waybill ||
    response?.output?.transactionShipments?.[0]?.masterTrackingNumber ||
    response?.output?.transactionShipments?.[0]?.pieceResponses?.[0]?.trackingNumber ||
    response?.packages?.[0]?.waybill ||
    response?.packages?.[0]?.waybill_number ||
    response?.upload_wbn ||
    ''
  );
}

function normalizeShipmentForWix(shipment) {
  return {
    waybill: shipment.waybill,
    courier_code: shipment.source || shipment.courierCode || 'delhivery',
    courier_service_code: shipment.shippingMode === 'S' ? 'surface' : 'express',
    service_mode:
      shipment.service_mode ||
      shipment.internationalService ||
      (shipment.shippingMode === 'S' ? 'Surface' : 'Express')
  };
}

export async function bookAmazonOrder(order, config, metadata = {}) {
  const orderId = order?.order?.AmazonOrderId || order?.external_order_id;
  if (!orderId) throw new Error('Amazon order is missing AmazonOrderId.');

  const existing = await findShipmentByOrderId(String(orderId));
  if (existing?.status === 'booked' && !metadata.allowMultipleShipments) {
    return { shipment: existing, skipped: true };
  }

  const persistedOrder = await upsertAmazonOrder(order);
  const bookingConfig = withShippingMode(config, metadata.shippingMode);
  const courier = getCourierAdapter(metadata.courierCode || 'delhivery');
  const payload = courier.mapOrder(order, bookingConfig, {
    internationalService: metadata.internationalService,
    reverse: metadata.reverse,
    orderNumberOverride: metadata.orderNumberOverride,
    deliveryOverride: metadata.deliveryOverride
  });
  const pending = await upsertShipment({
    ...metadata,
    createNewShipment: metadata.allowMultipleShipments,
    dbOrderId: persistedOrder?.id,
    orderId: String(orderId),
    orderNumber: payload.shipments?.[0]?.order || metadata.orderNumberOverride || orderId,
    courierCode: courier.code,
    status: bookingConfig.createAwbOnBook ? 'pending' : 'pending-zone',
    requestPayload: payload
  });

  if (!bookingConfig.createAwbOnBook) {
    return {
      shipment: {
        ...pending,
        message: 'Queued pending. AWB creation is disabled by CREATE_AWB_ON_BOOK=false.'
      },
      skipped: false
    };
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
    await syncBookedShipmentToAmazon(persistedOrder, booked, bookingConfig);
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

export async function syncBookedShipmentToAmazon(order, shipment, config) {
  if (!order?.id || !shipment?.waybill) return null;
  const { syncShipmentTrackingToAmazon } = await import('./amazonShipmentSync.js');
  return syncShipmentTrackingToAmazon(order, shipment, config);
}

export async function bookAmazonOrderById(orderId, config, metadata = {}) {
  const orderRow = await findOrderById(orderId);
  if (!orderRow) throw new Error('Order not found.');
  if (!orderRow.raw_order) throw new Error('Raw order payload is missing.');
  return bookAmazonOrder(orderRow.raw_order, config, {
    ...metadata,
    dbOrderId: orderRow.id
  });
}
