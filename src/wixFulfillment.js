export async function createWixFulfillment(order, shipment, config) {
  if (!config.wix.fulfillmentSyncEnabled) {
    return { skipped: true, status: 'disabled' };
  }
  if (!config.wix.authToken) throw new Error('WIX_AUTH_TOKEN is required to update Wix fulfillment.');
  if (!config.wix.siteId) throw new Error('WIX_SITE_ID is required to update Wix fulfillment.');
  if (!order?.wix_order_id) throw new Error('Wix order ID is required to update fulfillment.');
  if (!shipment?.waybill) throw new Error('AWB is required to update Wix fulfillment.');

  const body = {
    fulfillment: removeEmpty({
      trackingInfo: removeEmpty({
        trackingNumber: shipment.waybill,
        shippingProvider: shipment.service_mode || shipment.courier_service_code || shipment.courier_code || 'Delhivery',
        trackingLink: buildTrackingUrl(shipment.waybill, config, shipment.courier_code, shipment.tracking_url)
      }),
      lineItems: buildLineItems(order.raw_order)
    })
  };

  const controller = createTimeoutController(config);
  const response = await fetch(
    `https://www.wixapis.com/ecom/v1/fulfillments/orders/${encodeURIComponent(order.wix_order_id)}/create-fulfillment`,
    {
      method: 'POST',
      headers: wixHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal
    }
  );
  controller.clear();

  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Wix create fulfillment failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const fulfillment =
    payload?.fulfillment ||
    payload?.orderWithFulfillments?.fulfillments?.find(item => item?.trackingInfo?.trackingNumber === shipment.waybill) ||
    payload?.fulfillments?.find(item => item?.trackingInfo?.trackingNumber === shipment.waybill) ||
    {};
  return {
    status: 'synced',
    fulfillmentId: fulfillment.id || payload?.id || '',
    response: payload
  };
}

/**
 * Wix permits tracking fields on an existing fulfillment to be updated. This
 * is the required path when a replacement/rebooked shipment has a newer AWB.
 */
export async function updateWixFulfillmentTracking(order, fulfillmentId, shipment, config) {
  if (!config.wix.fulfillmentSyncEnabled) return { skipped: true, status: 'disabled' };
  if (!config.wix.authToken) throw new Error('WIX_AUTH_TOKEN is required to update Wix fulfillment.');
  if (!config.wix.siteId) throw new Error('WIX_SITE_ID is required to update Wix fulfillment.');
  if (!order?.wix_order_id) throw new Error('Wix order ID is required to update fulfillment.');
  if (!fulfillmentId) throw new Error('Wix fulfillment ID is required to update tracking.');
  if (!shipment?.waybill) throw new Error('AWB is required to update Wix fulfillment tracking.');

  const body = {
    fulfillment: {
      trackingInfo: removeEmpty({
        trackingNumber: shipment.waybill,
        shippingProvider: shipment.service_mode || shipment.courier_service_code || shipment.courier_code || 'Delhivery',
        trackingLink: buildTrackingUrl(shipment.waybill, config, shipment.courier_code, shipment.tracking_url)
      })
    }
  };
  const controller = createTimeoutController(config);
  const response = await fetch(
    `https://www.wixapis.com/ecom/v1/fulfillments/${encodeURIComponent(fulfillmentId)}/orders/${encodeURIComponent(order.wix_order_id)}`,
    { method: 'PATCH', headers: wixHeaders(config), body: JSON.stringify(body), signal: controller.signal }
  );
  controller.clear();
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(`Wix update fulfillment failed (${response.status}): ${JSON.stringify(payload)}`);
  return { status: 'synced', fulfillmentId, response: payload };
}

/** Remove the Wix fulfillment when its shipment is cancelled before delivery. */
export async function deleteWixFulfillment(order, fulfillmentId, config) {
  if (!config.wix.fulfillmentSyncEnabled) return { skipped: true, status: 'disabled' };
  if (!config.wix.authToken) throw new Error('WIX_AUTH_TOKEN is required to delete Wix fulfillment.');
  if (!config.wix.siteId) throw new Error('WIX_SITE_ID is required to delete Wix fulfillment.');
  if (!order?.wix_order_id) throw new Error('Wix order ID is required to delete fulfillment.');
  if (!fulfillmentId) return { skipped: true, status: 'not-synced' };

  const controller = createTimeoutController(config);
  const response = await fetch(
    `https://www.wixapis.com/ecom/v1/fulfillments/${encodeURIComponent(fulfillmentId)}/orders/${encodeURIComponent(order.wix_order_id)}`,
    { method: 'DELETE', headers: wixHeaders(config), signal: controller.signal }
  );
  controller.clear();
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(`Wix delete fulfillment failed (${response.status}): ${JSON.stringify(payload)}`);
  return { status: 'deleted', fulfillmentId, response: payload };
}

export function buildTrackingUrl(waybill, config, courierCode = 'delhivery', explicitTrackingUrl = '') {
  if (String(explicitTrackingUrl || '').trim()) return String(explicitTrackingUrl).trim();
  let template = config.wix.trackingUrlTemplate;
  if (!template || template.includes('delhivery.com')) {
    if (courierCode === 'fedex') {
      template = config.fedex?.trackingUrlTemplate || 'https://www.fedex.com/fedextrack/?trknbr={waybill}';
    } else if (courierCode === 'shiprocket') {
      template = config.shiprocket?.trackingUrlTemplate || 'https://www.shiprocket.in/shipment-tracking/{waybill}';
    } else {
      template = config.delhivery.trackingUrlTemplate || 'https://www.delhivery.com/track/package/{waybill}';
    }
  }
  return template ? template.replaceAll('{waybill}', encodeURIComponent(waybill)) : '';
}

function buildLineItems(order) {
  const items = (order?.lineItems || [])
    .map(item =>
      removeEmpty({
        id: item.id,
        quantity: Number(item.quantity || 1)
      })
    )
    .filter(item => item.id);
  return items.length ? items : undefined;
}

function wixHeaders(config) {
  return removeEmpty({
    Authorization: config.wix.authToken,
    'Content-Type': 'application/json',
    'wix-site-id': config.wix.siteId,
    'wix-account-id': config.wix.accountId
  });
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function createTimeoutController(config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.wix.requestTimeoutMs || 30_000);
  timeout.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}
