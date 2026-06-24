import { updateOrderWixFulfillment } from './store.js';
import { confirmAmazonShipment } from './amazon.js';

/**
 * Sends shipment/tracking confirmation back to Amazon SP-API.
 */
export async function syncShipmentTrackingToAmazon(order, shipment, config) {
  if (!order?.id || !shipment?.waybill) return null;

  await updateOrderWixFulfillment(order.id, {
    status: 'pending-fulfillment',
    error: null
  });

  try {
    const rawItems = order.raw_order?.items;
    let items = [];
    if (rawItems && rawItems.length > 0) {
      items = rawItems;
    } else {
      // Fallback: fetch items from Supabase
      const { getSupabaseClient } = await import('./store.js');
      const supabase = getSupabaseClient();
      if (supabase) {
        items = await supabase.select('order_items', `order_id=eq.${encodeURIComponent(order.id)}`) || [];
      }
    }

    const carrierCode = shipment.source || shipment.courier_code || 'Delhivery';
    const shippingMethod = shipment.courier_service_code || (shipment.shippingMode === 'S' ? 'surface' : 'express');

    // Handle Demo Mode if Amazon SP-API keys are missing
    if (!config.amazon.clientId || !config.amazon.clientSecret || !config.amazon.refreshToken) {
      console.log(`Demo Mode: Mocking Amazon shipment confirmation for order ${order.external_order_id || order.order_number}`);
      return updateOrderWixFulfillment(order.id, {
        status: 'fulfilled',
        fulfillmentId: 'MOCK-AMZ-FULFILLMENT-ID',
        syncedAt: new Date().toISOString(),
        error: null
      });
    }

    await confirmAmazonShipment(
      order.external_order_id || order.order_number,
      shipment.waybill,
      carrierCode,
      shippingMethod,
      items,
      config
    );

    return updateOrderWixFulfillment(order.id, {
      status: 'fulfilled',
      fulfillmentId: `AMZ-FULFILLMENT-${Date.now()}`,
      syncedAt: new Date().toISOString(),
      error: null
    });
  } catch (error) {
    console.error(`Amazon shipment sync failed: ${error.message}`);
    return updateOrderWixFulfillment(order.id, {
      status: 'failed',
      fulfillmentId: order.wix_fulfillment_id || null,
      error: error.message
    });
  }
}
