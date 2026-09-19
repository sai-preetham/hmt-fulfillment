export const ABANDONED_CART_INSTALLATION_VIDEO = 'https://youtu.be/LO9kg1WaPO0?si=cGz2dDnoWiIbYzaT';

export function abandonedCartWhatsAppUrl(lead = {}) {
  const phone = whatsappPhone(lead.phone);
  if (!phone) return '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(abandonedCartWhatsAppMessage(lead))}`;
}

export function abandonedCartWhatsAppMessage(lead = {}) {
  const name = cleanText(lead.customer_name) || 'there';
  const product = firstProductName(lead.items);
  const purchase = product ? `purchase ${product}` : 'complete your purchase';

  return [
    `Hello ${name},`,
    `This is Preetham from Hold My Throttle. I just noticed that you were trying to ${purchase}.`,
    `Here's the installation video: ${ABANDONED_CART_INSTALLATION_VIDEO}`,
    'Please let us know if I can help you in any way.'
  ].join('\n');
}

export function whatsappPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : '';
}

function firstProductName(items) {
  for (const item of items || []) {
    const value = item.productName?.translated || item.productName?.original || item.productName || item.name || item.product?.name;
    const name = cleanText(value);
    if (name) return name;
  }
  return '';
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
