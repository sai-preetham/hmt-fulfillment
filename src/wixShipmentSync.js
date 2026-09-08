import { findDeliveredShipmentForOrder, findLatestShipmentForOrder, findOrderById, updateOrderWixFulfillment } from './store.js';
import { createWixFulfillment, deleteWixFulfillment, updateWixFulfillmentTracking } from './wixFulfillment.js';
import { fetchWixOrderFulfillments } from './wix.js';

export async function syncShipmentTrackingToWix(order, shipment, config) {
  if (!order?.id || !shipment?.waybill) return null;
  // Wix stores tracking information on a fulfillment, and creating a
  // fulfillment marks its line items as fulfilled. Keep the AWB/link in the
  // CRM at booking time; defer the Wix call until an operator marks the shipment fulfilled.
  return updateOrderWixFulfillment(order.id, {
    status: 'awaiting-pickup',
    fulfillmentId: order.wix_fulfillment_id,
    syncedAt: order.wix_fulfillment_synced_at,
    error: null
  });
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
  // Carrier events update tracking locally; fulfillment requires an operator action.
  return null;
}

/**
 * Explicit operator fulfillment action. Saving or booking an AWB must never
 * call this helper; Wix records tracking and fulfills the items together.
 */
export async function fulfillManualShipmentInWix(order, shipment, config) {
  if (!order?.id || !order?.wix_order_id || !shipment?.waybill) return null;

  await updateOrderWixFulfillment(order.id, {
    status: 'pending-fulfillment',
    fulfillmentId: order.wix_fulfillment_id,
    syncedAt: order.wix_fulfillment_synced_at,
    error: null
  });

  try {
    const normalizedShipment = normalizeShipmentForWix(shipment);
    const result = order.wix_fulfillment_id
      ? await updateWixFulfillmentTracking(order, order.wix_fulfillment_id, normalizedShipment, config)
      : await createWixFulfillment(order, normalizedShipment, config);

    if (result.skipped) {
      return updateOrderWixFulfillment(order.id, { status: result.status, error: null });
    }

    return updateOrderWixFulfillment(order.id, {
      status: 'fulfilled',
      fulfillmentId: result.fulfillmentId || order.wix_fulfillment_id,
      fulfillmentStatus: 'FULFILLED',
      syncedAt: new Date().toISOString(),
      error: null
    });
  } catch (error) {
    return updateOrderWixFulfillment(order.id, {
      status: 'failed',
      fulfillmentId: order.wix_fulfillment_id || null,
      error: error.message
    });
  }
}

/**
 * Remove an already-created Wix fulfillment after the carrier cancels its
 * shipment. This returns the Wix order to NOT_FULFILLED so it can be rebooked.
 */
export async function rollbackCancelledShipmentInWix(shipment, config) {
  const orderId = shipment?.order_id || shipment?.dbOrderId || shipment?.orderId;
  if (!orderId) return null;
  const order = await findOrderById(orderId);
  if (!order?.wix_fulfillment_id) return null;
  const deliveredShipment = await findDeliveredShipmentForOrder(orderId);
  if (deliveredShipment && deliveredShipment.waybill !== shipment.waybill) return null;

  const fulfillments = await fetchWixOrderFulfillments(order.wix_order_id, config);
  const fulfillment = fulfillments.find(item => item.id === order.wix_fulfillment_id);
  // A replacement shipment may have changed the same Wix fulfillment to a new
  // AWB. Never delete it because an older shipment was later cancelled.
  if (fulfillment?.trackingInfo?.trackingNumber !== shipment.waybill) return null;

  await deleteWixFulfillment(order, order.wix_fulfillment_id, config);
  return updateOrderWixFulfillment(order.id, {
    status: 'cancelled',
    fulfillmentId: null,
    fulfillmentStatus: 'NOT_FULFILLED',
    syncedAt: new Date().toISOString(),
    error: null
  });
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
    const result = await createWixFulfillment(order, normalizedShipment, config);

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
    tracking_url: shipment.tracking_url || '',
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
