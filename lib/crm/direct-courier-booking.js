export function normalizeDirectBookingSource(source) {
  return String(source || 'wix').trim().toLowerCase();
}

export function isDirectCourierBookableSource(source) {
  return ['wix', 'amazon', 'woocommerce', 'woo'].includes(normalizeDirectBookingSource(source));
}

export function hasDirectCourierBookingIdentity(order = {}) {
  return Boolean(order.wix_order_id || order.external_order_id || order.woo_order_id);
}

export function directCourierBookingDeniedReason(order = {}) {
  if (!isDirectCourierBookableSource(order.source || 'wix') || !hasDirectCourierBookingIdentity(order)) {
    return 'Direct courier booking is currently wired for Wix, Amazon, and WooCommerce orders. Use manual AWB save for manual orders.';
  }
  return null;
}
