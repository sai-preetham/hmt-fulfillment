/**
 * Shared Ops channel fulfill on pickup (manual Mark picked up OR carrier tracking ≥ picked-up).
 * Wix: create/update fulfillment with tracking (same as fulfillManualShipmentInWix).
 * Woo: meta-only write-back with shipment status picked_up (feature-flagged, soft-fail).
 */
import { findOrderById } from './store.js';
import { fulfillManualShipmentInWix, isPickedUpOrLater } from './wixShipmentSync.js';
import { isWooCommerceOrder, writeWooShipmentOnPickedUp } from './wooShipmentSync.js';

export { isPickedUpOrLater };

function sameWaybill(left, right) {
  return String(left || '').trim() === String(right || '').trim() && Boolean(String(left || '').trim());
}

/**
 * Idempotent skip: already fulfilled in Wix for this AWB.
 */
export function shouldSkipWixFulfillment(order, shipment) {
  if (!order?.wix_order_id) return true;
  const waybill = String(shipment?.waybill || shipment?.awb_number || '').trim();
  if (!waybill) return true;
  if (order.wix_fulfillment_status !== 'fulfilled') return false;
  const knownAwb = order.awb_number || order.shipment_waybill || '';
  // If Ops already marked fulfilled for this same AWB, skip re-create.
  if (sameWaybill(knownAwb, waybill) && order.wix_fulfillment_id) return true;
  // Fulfilled without a matching AWB (rebook) — allow update path via fulfillManualShipmentInWix.
  return false;
}

/**
 * Create/update Wix fulfillment + Woo shipment meta when a shipment is collected
 * (or tracking progresses to picked-up / later).
 *
 * @param {object} order
 * @param {object} shipment
 * @param {object} config
 * @param {{ softFailWix?: boolean }} [options]
 *   softFailWix: when true (tracking callback), Wix errors are logged and returned; Ops continues.
 *   Manual Mark picked up leaves softFailWix false/undefined so callers can hard-fail on Wix.
 */
export async function fulfillShipmentChannelsOnPickup(order, shipment, config, options = {}) {
  const result = { wix: null, woo: null };

  if (order?.wix_order_id) {
    if (config?.wix?.fulfillmentSyncEnabled === false) {
      result.wix = { skipped: true, reason: 'wix-disabled' };
    } else if (shouldSkipWixFulfillment(order, shipment)) {
      result.wix = { skipped: true, reason: 'already-fulfilled' };
    } else {
      try {
        result.wix = await fulfillManualShipmentInWix(order, shipment, config);
      } catch (error) {
        console.error(
          `[channel-fulfill] Wix fulfill failed for order ${order.id} shipment ${shipment?.id || ''}: ${error.message}`
        );
        result.wix = { ok: false, error: error.message };
        if (!options.softFailWix) throw error;
      }
    }
  }

  if (isWooCommerceOrder(order)) {
    try {
      result.woo = await writeWooShipmentOnPickedUp(order, shipment, config);
    } catch (error) {
      console.error(
        `[woo-shipment-writeback] picked_up soft-fail for order ${order?.id || ''}: ${error.message}`
      );
      result.woo = { ok: false, error: error.message };
    }
  }

  return result;
}

/**
 * Carrier tracking status callback: when status reaches picked-up or later,
 * fulfill Wix / write Woo meta. Soft-fails channel errors so WhatsApp / poll continue.
 */
export async function fulfillChannelsForTrackingStatusChange(shipment, config, options = {}) {
  if (!isPickedUpOrLater(shipment?.status)) {
    return { skipped: true, reason: 'status-before-pickup' };
  }
  const orderId = shipment?.order_id || shipment?.dbOrderId || shipment?.orderId;
  if (!orderId) return { skipped: true, reason: 'no-order-id' };

  const loadOrder = options.findOrderById || findOrderById;
  const order = await loadOrder(orderId);
  if (!order) return { skipped: true, reason: 'order-not-found' };

  return fulfillShipmentChannelsOnPickup(order, shipment, config, {
    softFailWix: true,
    ...options
  });
}

/**
 * Build onShipmentStatusChanged for createDelhiveryTrackingSync call sites
 * (automation poll, /api/tracking/sync, pickups/refresh).
 */
export function createTrackingPickupFulfillHandler(config, options = {}) {
  return async function onShipmentStatusChanged(shipment) {
    try {
      return await fulfillChannelsForTrackingStatusChange(shipment, config, options);
    } catch (error) {
      console.error(
        `[channel-fulfill] tracking callback soft-fail for shipment ${shipment?.id || shipment?.waybill || ''}: ${error.message}`
      );
      return { ok: false, error: error.message };
    }
  };
}
