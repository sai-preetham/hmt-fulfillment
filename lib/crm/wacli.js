import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function whatsappRecipient(order = {}) {
  const value = order.whatsapp_number || order.shipping_address?.phone || order.customers?.phone || '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  // Domestic checkout numbers are commonly stored without a country code.
  // Keep the default explicit so international stores can opt out or override it.
  const defaultCountryCode = String(process.env.WACLI_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');
  return digits.length === 10 && defaultCountryCode ? `${defaultCountryCode}${digits}` : digits;
}

export function buildWhatsAppOrderUpdate(order, shipment) {
  const orderNumber = order.order_number || order.external_order_id || order.wix_order_id || order.id;
  const status = normalizeStatus(shipment.status || order.shipment_status || 'booked');
  const awb = shipment.waybill || order.awb_number || order.shipment_waybill || '';
  const trackingUrl = shipment.tracking_url || order.tracking_url || trackingUrlFor(shipment.courier_code || order.courier, awb);

  const heading = {
    booked: 'has been booked for shipment.',
    'out-for-delivery': 'is out for delivery today.',
    delivered: 'has been delivered.',
    'picked-up': 'has been picked up by the courier.',
    dispatched: 'has been dispatched.',
    'in-transit': 'is in transit.'
  }[status] || `has a shipment update: ${status.replaceAll('-', ' ')}.`;

  return [
    `Hold My Throttle: your order ${orderNumber} ${heading}`,
    awb ? `Tracking number: ${awb}` : '',
    trackingUrl ? `Track: ${trackingUrl}` : ''
  ].filter(Boolean).join('\n');
}

export async function sendWhatsAppOrderUpdate(order, shipment) {
  const content = buildWhatsAppOrderUpdate(order, shipment);
  if (process.env.WACLI_ORDER_UPDATES_ENABLED !== 'true') {
    return { skipped: true, reason: 'whatsapp-updates-disabled', content };
  }

  const recipient = whatsappRecipient(order);
  if (!recipient) return { skipped: true, reason: 'missing-whatsapp-number', content };

  const binary = process.env.WACLI_BIN || 'wacli';
  const args = ['send', 'text', '--to', recipient, '--message', content, '--no-preview', '--json'];
  if (process.env.WACLI_ACCOUNT) args.unshift('--account', process.env.WACLI_ACCOUNT);
  if (process.env.WACLI_STORE_DIR) args.unshift('--store', process.env.WACLI_STORE_DIR);

  try {
    const { stdout } = await execFileAsync(binary, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: process.env
    });
    const response = parseJson(stdout);
    return { skipped: false, providerMessageId: response?.ID || response?.id || '', content, response };
  } catch (error) {
    const detail = error.stderr || error.message || 'Unknown wacli error';
    throw new Error(`WhatsApp send failed: ${String(detail).trim()}`);
  }
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

function trackingUrlFor(courier, awb) {
  if (!awb) return '';
  if (courier === 'shiprocket') return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  if (courier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(awb)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}
