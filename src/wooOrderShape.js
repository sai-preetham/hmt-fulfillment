/**
 * Detect / adapt WooCommerce REST order payloads for courier mappers
 * that historically expected Wix or Amazon shapes.
 */

export function isWooCommerceRawOrder(order) {
  if (!order || typeof order !== 'object') return false;
  // Amazon SP-API aggregate used by mapAmazonOrderToDelhivery
  if (order.order && order.address && order.buyer) return false;
  // Native Wix order shape
  if (order.lineItems || order.shippingInfo || order.priceSummary) return false;
  return Boolean(
    Array.isArray(order.line_items) ||
      order.billing ||
      order.shipping ||
      order.payment_method != null ||
      order.payment_method_title != null
  );
}

export function isWooCommerceSource(source) {
  const normalized = String(source || '')
    .trim()
    .toLowerCase();
  return normalized === 'woocommerce' || normalized === 'woo';
}

/**
 * Build a minimal Wix-like view so FedEx / shared helpers can reuse Wix mappers.
 * Prefer dedicated Delhivery Woo mapping for domestic booking accuracy.
 */
export function wooCommerceOrderToWixLike(order = {}) {
  const shipping = order.shipping || {};
  const billing = order.billing || {};
  const shipHasAddress = Boolean(shipping.address_1 || shipping.city || shipping.postcode);
  const addressSource = shipHasAddress ? shipping : billing;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  return {
    id: order.id != null ? String(order.id) : '',
    number: String(order.number || order.id || ''),
    currency: order.currency || 'INR',
    paymentStatus: mapWooPaymentStatusToWix(order),
    paymentOption: isWooCod(order) ? 'FULL_PAYMENT_OFFLINE' : undefined,
    buyerInfo: {
      email: billing.email || order.billing?.email || ''
    },
    priceSummary: {
      total: { amount: String(order.total ?? '0') }
    },
    lineItems: lineItems.map(item => ({
      name: item.name || 'Item',
      productName: { original: item.name || 'Item' },
      quantity: Number(item.quantity || 1),
      physicalProperties: { sku: item.sku || undefined },
      price: { amount: String(item.price ?? item.total ?? '0') },
      totalPriceBeforeTax: { amount: String(item.total ?? item.subtotal ?? '0') },
      totalPriceAfterTax: { amount: String(item.total ?? item.subtotal ?? '0') }
    })),
    shippingInfo: {
      logistics: {
        shippingDestination: {
          address: {
            addressLine: addressSource.address_1 || '',
            addressLine2: addressSource.address_2 || '',
            city: addressSource.city || '',
            subdivision: addressSource.state || '',
            postalCode: addressSource.postcode || '',
            country: addressSource.country || 'IN'
          },
          contactDetails: {
            firstName: addressSource.first_name || billing.first_name || '',
            lastName: addressSource.last_name || billing.last_name || '',
            phone: addressSource.phone || billing.phone || ''
          }
        }
      }
    }
  };
}

function isWooCod(order) {
  const method = String(order.payment_method || '').toLowerCase();
  const title = String(order.payment_method_title || '').toLowerCase();
  return method === 'cod' || title.includes('cash on delivery') || title === 'cod';
}

function mapWooPaymentStatusToWix(order) {
  if (isWooCod(order) && !order.date_paid && !order.date_paid_gmt) return 'NOT_PAID';
  const status = String(order.status || '').toLowerCase();
  if (['pending', 'on-hold', 'failed'].includes(status)) return 'NOT_PAID';
  if (order.date_paid || order.date_paid_gmt || ['processing', 'completed'].includes(status)) return 'PAID';
  return 'PAID';
}
