import { findLatestShipmentForOrder, findOrderById, updateOrderWixFulfillment } from './store.js';
import { createWixFulfillment, updateWixFulfillment } from './wixFulfillment.js';

export async function syncShipmentTrackingToWix(order, shipment, config) {
  if (!order?.id || !shipment?.waybill) return null;
  return syncWixFulfillment(order, shipment, config, 'PENDING');
}

export async function markOrderPackedInWix(orderId, config) {
  if (!orderId) return null;
  const order = await findOrderById(orderId);
  if (!order) return null;
  const shipment = await findLatestShipmentForOrder(order);
  if (!shipment?.waybill && !order.awb_number && !order.shipment_waybill) return null;
  return syncWixFulfillment(
    order,
    {
      ...shipment,
      waybill: shipment?.waybill || order.awb_number || order.shipment_waybill,
      status: 'packed'
    },
    config,
    'FULFILLED'
  );
}

export async function markShipmentPickedUpInWix(shipment, config) {
  if (!shipment?.order_id && !shipment?.orderId && !shipment?.dbOrderId) return null;
  const orderId = shipment.order_id || shipment.dbOrderId || shipment.orderId;
  const order = await findOrderById(orderId);
  if (!order || !shipment?.waybill) return null;
  return syncWixFulfillment(order, shipment, config, 'FULFILLED');
}

export function isPickedUpOrLater(status) {
  const normalized = normalizeShipmentStatus(status);
  return ['picked-up', 'dispatched', 'in-transit', 'out-for-delivery', 'delivered'].includes(normalized);
}

async function syncWixFulfillment(order, shipment, config, fulfillmentStatus) {
  await updateOrderWixFulfillment(order.id, {
    status: fulfillmentStatus === 'FULFILLED' ? 'pending-fulfillment' : 'pending-tracking',
    error: null
  });

  try {
    const existingFulfillmentId = order.wix_fulfillment_id || shipment.wix_fulfillment_id || '';
    const normalizedShipment = normalizeShipmentForWix(shipment);
    const result = existingFulfillmentId
      ? await updateWixFulfillment(order, existingFulfillmentId, normalizedShipment, config)
      : await createWixFulfillment(order, normalizedShipment, config);

    if (result.skipped) {
      return updateOrderWixFulfillment(order.id, {
        status: result.status,
        error: null
      });
    }

    return updateOrderWixFulfillment(order.id, {
      status: fulfillmentStatus === 'FULFILLED' ? 'fulfilled' : 'tracking-synced',
      fulfillmentId: result.fulfillmentId || existingFulfillmentId,
      syncedAt: new Date().toISOString(),
      error: null
    });
  } catch (error) {
    return updateOrderWixFulfillment(order.id, {
      status: 'failed',
      fulfillmentId: order.wix_fulfillment_id || shipment.wix_fulfillment_id || null,
      error: error.message
    });
  }
}

function normalizeShipmentForWix(shipment) {
  return {
    waybill: shipment.waybill,
    courier_code: shipment.source || shipment.courier_code || 'delhivery',
    courier_service_code: shipment.courier_service_code || (shipment.shippingMode === 'S' ? 'surface' : 'express'),
    service_mode:
      shipment.service_mode ||
      shipment.internationalService ||
      (shipment.shippingMode === 'S' ? 'Surface' : 'Express')
  };
}

function normalizeShipmentStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized.includes('delivered')) return 'delivered';
  if (normalized.includes('out for delivery') || normalized.includes('out-for-delivery')) return 'out-for-delivery';
  if (normalized.includes('in transit') || normalized.includes('in-transit') || normalized === 'intransit') return 'in-transit';
  if (normalized.includes('picked up') || normalized.includes('picked-up') || normalized === 'pickup' || normalized === 'pickedup') return 'picked-up';
  if (normalized.includes('dispatched') || normalized.includes('shipped')) return 'dispatched';
  return normalized;
}
