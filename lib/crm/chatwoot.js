export function buildTrackingMessage(order, shipment) {
  const orderNumber = order.order_number || order.external_order_id || order.wix_order_id || order.id;
  const courier = shipment.courier_code || order.courier || 'courier';
  const awb = shipment.waybill || order.awb_number || order.shipment_waybill;
  const trackingUrl = shipment.tracking_url || order.tracking_url || trackingUrlFor(courier, awb);
  return [
    `Your Hold My Throttle order ${orderNumber} has been booked for shipment.`,
    `Courier: ${formatCourier(courier)}`,
    `Tracking number: ${awb}`,
    trackingUrl ? `Tracking link: ${trackingUrl}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export async function sendChatwootTrackingMessage(order, shipment, options = {}) {
  const baseUrl = trimTrailingSlash(process.env.CHATWOOT_BASE_URL || '');
  const accountId = process.env.CHATWOOT_ACCOUNT_ID || '';
  const token = process.env.CHATWOOT_API_TOKEN || process.env.CHATWOOT_ACCESS_TOKEN || '';
  const conversationId = order.chatwoot_conversation_id || options.conversationId || '';
  const content = options.content || buildTrackingMessage(order, shipment);

  if (!baseUrl || !accountId || !token) {
    return { skipped: true, reason: 'missing-chatwoot-config', content };
  }
  if (!conversationId) {
    return { skipped: true, reason: 'missing-chatwoot-conversation', content };
  }

  const response = await fetch(`${baseUrl}/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: {
      api_access_token: token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      message_type: 'outgoing',
      private: false
    })
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Chatwoot tracking message failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return {
    status: 'sent',
    providerMessageId: payload.id || payload.message?.id || '',
    response: payload,
    content
  };
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function formatCourier(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function trackingUrlFor(courier, awb) {
  if (!awb) return '';
  if (courier === 'shiprocket') return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  if (courier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(awb)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
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
