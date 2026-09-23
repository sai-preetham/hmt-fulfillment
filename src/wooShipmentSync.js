/**
 * Ops → WooCommerce shipment write-back (meta-only).
 * Mirrors Wix channel sync call sites for Woo-sourced orders.
 * Never sends customer email/WhatsApp; never changes WC order status.
 */
import { buildTrackingUrl } from './wixFulfillment.js';
import {
  buildHmtShipmentMetaData,
  normalizeCarrierSlug,
  normalizeShipmentStatus,
  updateWooCommerceOrderShipmentMeta
} from './woocommerce.js';

export function isWooCommerceOrder(order) {
  if (!order) return false;
  const source = String(order.source || '').toLowerCase();
  const wooOrderId = order.woo_order_id || (source === 'woocommerce' ? order.external_order_id : null);
  return source === 'woocommerce' && Boolean(wooOrderId);
}

export function resolveWooOrderId(order) {
  if (!order) return '';
  return String(order.woo_order_id || (String(order.source || '').toLowerCase() === 'woocommerce' ? order.external_order_id : '') || '').trim();
}

export function isWooShipmentWritebackEnabled(config) {
  return config?.woocommerce?.shipmentWriteback?.enabled === true;
}

/**
 * Soft-fail write-back of tracking meta to Woo on booked / picked_up.
 * Safe to retry (meta upsert by key + ops shipment id).
 */
export async function syncShipmentTrackingToWoo(order, shipment, config, options = {}) {
  if (!isWooShipmentWritebackEnabled(config)) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!isWooCommerceOrder(order)) {
    return { skipped: true, reason: 'not-woo-order' };
  }

  const waybill = String(shipment?.waybill || shipment?.awb_number || order?.awb_number || '').trim();
  if (!waybill) {
    return { skipped: true, reason: 'no-waybill' };
  }

  const wooOrderId = resolveWooOrderId(order);
  const courierCode = normalizeCarrierSlug(
    shipment?.courier_code || shipment?.courier || order?.courier || order?.shipment_courier_code || ''
  );
  const shipmentStatus = normalizeShipmentStatus(
    options.shipmentStatus || shipment?.status || 'booked'
  );
  const trackingUrl =
    String(shipment?.tracking_url || order?.tracking_url || '').trim() ||
    buildTrackingUrl(waybill, config, courierCode || 'delhivery', '');

  const meta = buildHmtShipmentMetaData({
    carrier: courierCode,
    awb: waybill,
    trackingUrl,
    shipmentStatus,
    opsShipmentId: shipment?.id || '',
    syncedAt: new Date().toISOString()
  });

  try {
    const response = await updateWooCommerceOrderShipmentMeta(wooOrderId, meta, config, {
      fetchImpl: options.fetchImpl
    });
    return {
      ok: true,
      woo_order_id: wooOrderId,
      shipment_status: shipmentStatus,
      meta_data: meta,
      response
    };
  } catch (error) {
    console.error(
      `[woo-shipment-writeback] failed for woo_order_id=${wooOrderId} shipment=${shipment?.id || ''} status=${shipmentStatus}: ${error.message}`
    );
    return { ok: false, error: error.message, woo_order_id: wooOrderId, shipment_status: shipmentStatus };
  }
}

export async function writeWooShipmentOnBooked(order, shipment, config, options = {}) {
  return syncShipmentTrackingToWoo(order, shipment, config, { ...options, shipmentStatus: 'booked' });
}

export async function writeWooShipmentOnPickedUp(order, shipment, config, options = {}) {
  return syncShipmentTrackingToWoo(order, shipment, config, { ...options, shipmentStatus: 'picked_up' });
}
