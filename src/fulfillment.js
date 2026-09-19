export function normalizeWixOrder(order, config = {}) {
  const destination = order?.shippingInfo?.logistics?.shippingDestination || {};
  const shippingAddress = destination.address || {};
  const shippingContact = destination.contactDetails || {};
  const billingAddress = order?.billingInfo?.address || {};
  const billingContact = order?.billingInfo?.contactDetails || {};
  const buyer = order?.buyerInfo || {};
  const price = order?.priceSummary || {};
  const balance = order?.balanceSummary || {};
  const contactId = buyer.contactId || buyer.memberId || '';
  const customerName = fullName(shippingContact) || fullName(billingContact);

  return {
    customer: {
      wix_contact_id: contactId || null,
      name: customerName || null,
      email: buyer.email || null,
      phone: shippingContact.phone || billingContact.phone || null,
      tax_id: billingContact?.vatId?.id || null,
      tax_id_type: billingContact?.vatId?.type || null,
      raw_customer: {
        buyerInfo: buyer,
        shippingContact,
        billingContact
      }
    },
    shippingAddress: normalizeAddress('shipping', shippingAddress, shippingContact),
    billingAddress: normalizeAddress('billing', billingAddress, billingContact),
    order: {
      wix_order_id: order.id,
      order_number: String(order.number || ''),
      status: order.status || null,
      payment_status: order.paymentStatus || null,
      fulfillment_status: order.fulfillmentStatus || null,
      currency: order.currency || null,
      subtotal: numberAmount(price.subtotal?.amount),
      shipping_amount: numberAmount(price.shipping?.amount),
      tax_amount: numberAmount(price.tax?.amount),
      discount_amount: numberAmount(price.discount?.amount),
      total_amount: numberAmount(price.total?.amount || price.totalPrice?.amount),
      selected_shipping_title: order?.shippingInfo?.title || null,
      source_created_at: order.createdDate || null,
      source_updated_at: order.updatedDate || null,
      raw_order: redactPaymentSecrets(order)
    },
    items: (order.lineItems || []).map(item => ({
      wix_line_item_id: item.id || null,
      catalog_item_id: item?.catalogReference?.catalogItemId || item?.rootCatalogItemId || null,
      variant_id: item?.catalogReference?.options?.variantId || null,
      sku: item?.physicalProperties?.sku || null,
      product_name: item?.productName?.original || item?.productName?.translated || item?.name || null,
      quantity: Number(item.quantity || 1),
      item_price: numberAmount(item?.price?.amount || item?.lineItemPrice?.amount),
      total_price: numberAmount(item?.totalPriceAfterTax?.amount || item?.totalPriceBeforeTax?.amount),
      weight: Number(item?.physicalProperties?.weight || 0) || null,
      hsn_code: config.defaults?.hsnCode || null,
      tax_info: item.taxInfo || item.taxDetails || {},
      raw_line_item: item
    })),
    payment: {
      payment_status: order.paymentStatus || null,
      payment_method: order?.lineItems?.[0]?.paymentOption || order.paymentOption || null,
      transaction_ref: null,
      paid_amount: numberAmount(balance.paid?.amount),
      refunded_amount: numberAmount(balance.refunded?.amount),
      authorized_amount: numberAmount(balance.authorized?.amount),
      currency: order.currency || null,
      raw_payment: {
        balanceSummary: balance,
        activities: order.activities || []
      }
    }
  };
}

export function normalizeShipmentRecord(record) {
  const payloadShipment = record.requestPayload?.shipments?.[0] || {};
  const international = record.requestPayload?.flow === 'international';
  const fedexShipment = record.requestPayload?.requestedShipment || {};
  const fedexPackageLineItem = fedexShipment.requestedPackageLineItems?.[0] || {};
  const responsePackage = record.delhiveryResponse?.packages?.[0] || {};
  const fedexPackage = record.delhiveryResponse?.output?.transactionShipments?.[0]?.pieceResponses?.[0] || {};
  const direction = record.reverse ? 'reverse' : payloadShipment.payment_mode === 'Pickup' ? 'reverse' : 'forward';
  const service = international
    ? normalizeServiceCode(record.serviceCode || record.internationalService || fedexShipment.serviceType || record.requestPayload?.shipment?.service)
    : normalizeDomesticService(record.shippingMode || payloadShipment.md);

  return {
    order_id: record.dbOrderId || null,
    legacy_order_id: record.orderId || null,
    order_number: record.orderNumber || payloadShipment.order || null,
    shipment_type: record.shipmentType || 'original',
    direction,
    flow: international ? 'international' : 'domestic',
    courier_code: record.courierCode || 'delhivery',
    courier_service_code: service,
    service_mode: international ? fedexShipment.serviceType || record.requestPayload?.shipment?.service || null : payloadShipment.shipping_mode || null,
    status: record.status || 'pending',
    waybill: record.waybill || responsePackage.waybill || record.delhiveryResponse?.waybill || fedexPackage.trackingNumber || null,
    upload_wbn: record.delhiveryResponse?.upload_wbn || null,
    pickup_location: record.requestPayload?.pickup_location?.name || fedexShipment.shipper?.contact?.personName || null,
    length_cm: numberAmount(payloadShipment.shipment_length || record.requestPayload?.shipment?.dimensionsCm?.length || fedexPackageLineItem.dimensions?.length),
    width_cm: numberAmount(payloadShipment.shipment_width || record.requestPayload?.shipment?.dimensionsCm?.width || fedexPackageLineItem.dimensions?.width),
    height_cm: numberAmount(payloadShipment.shipment_height || record.requestPayload?.shipment?.dimensionsCm?.height || fedexPackageLineItem.dimensions?.height),
    weight_grams: numberAmount(payloadShipment.weight || record.requestPayload?.shipment?.weightGrams || weightToGrams(fedexPackageLineItem.weight)),
    cod_amount: numberAmount(payloadShipment.cod_amount) || 0,
    request_payload: record.requestPayload || {},
    carrier_response: record.replacementPart
      ? { ...(record.delhiveryResponse || {}), replacement_part: record.replacementPart }
      : record.delhiveryResponse || null,
    label_url: record.labelUrl || record.delhiveryResponse?.label_url || null,
    label_format: record.labelFormat || record.delhiveryResponse?.label_format || null,
    error: record.error || null,
    message: record.message || null
  };
}

export function buildOrderShipmentSummary(shipment, observedAt = new Date().toISOString()) {
  const shipmentUpdatedAt = shipment.updated_at || observedAt;
  const waybill = shipment.waybill || shipment.upload_wbn || null;
  const summary = {
    shipment_status: shipment.status || null,
    shipment_waybill: waybill,
    shipment_courier_code: shipment.courier_code || null,
    shipment_service_code: shipment.courier_service_code || null,
    shipment_service_mode: shipment.service_mode || null,
    shipment_updated_at: shipmentUpdatedAt,
    updated_at: observedAt
  };

  if (shipment.status === 'booked' && waybill) {
    summary.shipment_booked_at = shipmentUpdatedAt;
  } else if (!waybill) {
    summary.shipment_booked_at = null;
  }

  if (shipment.status === 'delivered') {
    summary.internal_status = 'installation_pending';
  }

  return summary;
}

export function buildAudit(tableName, recordId, action, beforeJson, afterJson, reason) {
  return {
    table_name: tableName,
    record_id: recordId || null,
    action,
    before_json: beforeJson || null,
    after_json: afterJson || null,
    reason: reason || null
  };
}

function normalizeAddress(addressType, address, contact) {
  return {
    address_type: addressType,
    name: fullName(contact) || null,
    phone: contact.phone || null,
    address_line1: address.addressLine || formatStreetAddress(address.streetAddress) || null,
    address_line2: address.addressLine2 || null,
    city: address.city || null,
    state: address.subdivision || address.subdivisionFullname || null,
    postal_code: address.postalCode || null,
    country: address.country || null,
    raw_address: {
      address,
      contact
    }
  };
}

function fullName(contact = {}) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
}

function formatStreetAddress(street = {}) {
  return [street.name, street.number, street.apt].filter(Boolean).join(', ');
}

function numberAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDomesticService(mode) {
  return String(mode || '').toUpperCase() === 'S' ? 'surface' : 'express';
}

function normalizeServiceCode(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('fedex') && normalized.includes('priority')) return 'international_express';
  if (normalized.includes('saver')) return 'dlv_saver';
  if (normalized.includes('express')) return 'deferred_express';
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function weightToGrams(weight = {}) {
  const value = numberAmount(weight.value);
  if (!value) return null;
  const units = String(weight.units || '').trim().toUpperCase();
  if (units === 'KG' || units === 'KGS' || units === 'KILOGRAMS') return value * 1000;
  if (units === 'LB' || units === 'LBS' || units === 'POUNDS') return value * 453.59237;
  return value;
}

function redactPaymentSecrets(value) {
  const json = JSON.stringify(value || {});
  return JSON.parse(
    json.replace(/"([^"]*(?:card|cvv|account|upi|password|secret)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
  );
}

export function normalizeAmazonOrder(amazonPayload, config = {}) {
  const { order, address, buyer, items } = amazonPayload;
  const customerName = address?.Name || buyer?.BuyerName || 'Amazon Customer';

  return {
    customer: {
      wix_contact_id: null,
      name: customerName,
      email: buyer?.BuyerEmail || null,
      phone: address?.Phone || null,
      tax_id: buyer?.BuyerTaxInfo?.CompanyTaxEvaluator?.TaxRegistrationId || null,
      tax_id_type: null,
      raw_customer: {
        buyer,
        address
      }
    },
    shippingAddress: {
      address_type: 'shipping',
      name: address?.Name || customerName,
      phone: address?.Phone || null,
      address_line1: address?.AddressLine1 || '',
      address_line2: address?.AddressLine2 || '',
      city: address?.City || '',
      state: address?.StateOrRegion || '',
      postal_code: address?.PostalCode || '',
      country: address?.CountryCode || 'IN',
      raw_address: { address }
    },
    billingAddress: {
      address_type: 'billing',
      name: address?.Name || customerName,
      phone: address?.Phone || null,
      address_line1: address?.AddressLine1 || '',
      address_line2: address?.AddressLine2 || '',
      city: address?.City || '',
      state: address?.StateOrRegion || '',
      postal_code: address?.PostalCode || '',
      country: address?.CountryCode || 'IN',
      raw_address: { address }
    },
    order: {
      wix_order_id: null,
      external_order_id: order.AmazonOrderId,
      order_number: order.AmazonOrderId,
      source: 'amazon',
      status: mapAmazonStatus(order.OrderStatus),
      payment_status: 'paid',
      fulfillment_status: mapAmazonFulfillmentStatus(order.OrderStatus),
      currency: order.OrderTotal?.CurrencyCode || 'INR',
      subtotal: numberAmount(order.OrderTotal?.Amount),
      shipping_amount: 0,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: numberAmount(order.OrderTotal?.Amount),
      selected_shipping_title: order.ShipServiceLevel || null,
      source_created_at: order.PurchaseDate || null,
      source_updated_at: order.LastUpdateDate || null,
      raw_order: amazonPayload
    },
    items: (items || []).map(item => ({
      wix_line_item_id: item.OrderItemId,
      catalog_item_id: item.ASIN || null,
      variant_id: null,
      sku: item.SellerSKU || null,
      product_name: item.Title || null,
      quantity: Number(item.QuantityOrdered || 1),
      item_price: numberAmount(item.ItemPrice?.Amount) || 0,
      total_price: numberAmount(item.ItemPrice?.Amount) || 0,
      weight: config.defaults?.weightGrams ? config.defaults.weightGrams / 1000 : null,
      hsn_code: config.defaults?.hsnCode || null,
      tax_info: item.ItemTax || {},
      raw_line_item: item
    })),
    payment: {
      payment_status: 'paid',
      payment_method: order.PaymentMethod || 'Amazon',
      transaction_ref: order.AmazonOrderId,
      paid_amount: numberAmount(order.OrderTotal?.Amount),
      refunded_amount: 0,
      authorized_amount: numberAmount(order.OrderTotal?.Amount),
      currency: order.OrderTotal?.CurrencyCode || 'INR',
      raw_payment: { orderTotal: order.OrderTotal }
    }
  };
}

function mapAmazonStatus(status) {
  switch (status) {
    case 'Pending': return 'pending';
    case 'Unshipped': return 'paid';
    case 'PartiallyShipped': return 'partially_fulfilled';
    case 'Shipped': return 'fulfilled';
    case 'Canceled': return 'canceled';
    default: return 'unknown';
  }
}

function mapAmazonFulfillmentStatus(status) {
  switch (status) {
    case 'Pending': return 'not_fulfilled';
    case 'Unshipped': return 'not_fulfilled';
    case 'PartiallyShipped': return 'partially_fulfilled';
    case 'Shipped': return 'fulfilled';
    case 'Canceled': return 'canceled';
    default: return 'not_fulfilled';
  }
}

/**
 * Normalize a WooCommerce REST/webhook order payload into Ops CRM rows.
 * Accepts the raw Woo order object (order.created / order.updated body),
 * or `{ order: <wooOrder> }` / `{ woo_order: <wooOrder> }` wrappers.
 */
export function normalizeWooCommerceOrder(payload, config = {}) {
  const order = unwrapWooOrder(payload);
  if (!order?.id && order?.id !== 0) {
    throw new Error('WooCommerce order payload missing id.');
  }

  const wooOrderId = String(order.id);
  const orderNumber = String(order.number || order.id);
  const billing = order.billing || {};
  const shipping = order.shipping || {};
  const shipHasAddress = Boolean(shipping.address_1 || shipping.city || shipping.postcode);
  const addressSource = shipHasAddress ? shipping : billing;
  const customerName =
    [addressSource.first_name, addressSource.last_name].filter(Boolean).join(' ').trim() ||
    [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() ||
    'WooCommerce Customer';
  const phone = shipping.phone || billing.phone || order.billing?.phone || null;
  const email = order.billing?.email || billing.email || null;
  const paymentStatus = mapWooPaymentStatus(order);
  const fulfillmentStatus = mapWooFulfillmentStatus(order.status);
  const status = mapWooStatus(order.status);
  const currency = order.currency || 'INR';
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  return {
    customer: {
      wix_contact_id: null,
      name: customerName,
      email: email || null,
      phone: phone || null,
      tax_id: null,
      tax_id_type: null,
      raw_customer: {
        billing,
        shipping,
        customer_id: order.customer_id || null
      }
    },
    shippingAddress: {
      address_type: 'shipping',
      name:
        [addressSource.first_name, addressSource.last_name].filter(Boolean).join(' ').trim() ||
        customerName,
      phone: addressSource.phone || phone || null,
      address_line1: addressSource.address_1 || '',
      address_line2: addressSource.address_2 || '',
      city: addressSource.city || '',
      state: addressSource.state || '',
      postal_code: addressSource.postcode || '',
      country: addressSource.country || 'IN',
      raw_address: { address: addressSource }
    },
    billingAddress: {
      address_type: 'billing',
      name: [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || customerName,
      phone: billing.phone || phone || null,
      address_line1: billing.address_1 || '',
      address_line2: billing.address_2 || '',
      city: billing.city || '',
      state: billing.state || '',
      postal_code: billing.postcode || '',
      country: billing.country || 'IN',
      raw_address: { address: billing }
    },
    order: {
      wix_order_id: null,
      woo_order_id: wooOrderId,
      external_order_id: wooOrderId,
      order_number: orderNumber,
      source: 'woocommerce',
      status,
      payment_status: paymentStatus,
      fulfillment_status: fulfillmentStatus,
      currency,
      subtotal: lineItems.reduce((sum, item) => sum + numberAmount(item.subtotal != null ? item.subtotal : item.total), 0) || numberAmount(order.total),
      shipping_amount: numberAmount(order.shipping_total),
      tax_amount: numberAmount(order.total_tax),
      discount_amount: numberAmount(order.discount_total),
      total_amount: numberAmount(order.total),
      selected_shipping_title: firstWooShippingTitle(order),
      source_created_at: wooTimestamp(order.date_created_gmt, order.date_created),
      source_updated_at: wooTimestamp(order.date_modified_gmt, order.date_modified),
      raw_order: redactPaymentSecrets(order),
      bike_model: firstWooProductName(lineItems),
      product_variant: firstWooVariant(lineItems),
      quantity: lineItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 1,
      whatsapp_number: phone || null
    },
    items: lineItems.map(item => ({
      wix_line_item_id: item.id != null ? String(item.id) : `woo-${wooOrderId}-${item.sku || item.name || 'item'}`,
      catalog_item_id: item.product_id != null ? String(item.product_id) : null,
      variant_id: item.variation_id ? String(item.variation_id) : null,
      sku: item.sku || null,
      product_name: item.name || null,
      quantity: Number(item.quantity || 1),
      item_price: numberAmount(item.price),
      total_price: numberAmount(item.total),
      weight: config.defaults?.weightGrams ? config.defaults.weightGrams / 1000 : null,
      hsn_code: config.defaults?.hsnCode || null,
      tax_info: { total_tax: item.total_tax, taxes: item.taxes || [] },
      raw_line_item: item
    })),
    payment: {
      payment_status: paymentStatus,
      payment_method: order.payment_method_title || order.payment_method || 'WooCommerce',
      transaction_ref: order.transaction_id || wooOrderId,
      paid_amount: paymentStatus === 'paid' ? numberAmount(order.total) : 0,
      refunded_amount: Array.isArray(order.refunds)
        ? order.refunds.reduce((sum, refund) => sum + Math.abs(numberAmount(refund.total)), 0)
        : 0,
      authorized_amount: numberAmount(order.total),
      currency,
      raw_payment: {
        payment_method: order.payment_method,
        payment_method_title: order.payment_method_title,
        date_paid: order.date_paid || order.date_paid_gmt || null,
        transaction_id: order.transaction_id || null
      }
    }
  };
}

function unwrapWooOrder(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.id != null && (payload.billing || payload.line_items || payload.number != null)) return payload;
  if (payload.order && typeof payload.order === 'object') return payload.order;
  if (payload.woo_order && typeof payload.woo_order === 'object') return payload.woo_order;
  if (payload.data && typeof payload.data === 'object') return unwrapWooOrder(payload.data);
  return payload;
}

function mapWooPaymentStatus(order) {
  const status = String(order.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'failed' || status === 'trash') {
    return 'not_paid';
  }
  if (status === 'refunded') return 'refunded';
  if (order.date_paid || order.date_paid_gmt) return 'paid';
  if (['processing', 'completed', 'shipped'].includes(status)) return 'paid';
  if (status === 'on-hold') return 'pending';
  if (status === 'pending') return 'pending';
  return status || 'pending';
}

function mapWooStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'pending':
      return 'pending';
    case 'processing':
    case 'on-hold':
      return 'paid';
    case 'completed':
      return 'fulfilled';
    case 'cancelled':
    case 'canceled':
    case 'trash':
      return 'canceled';
    case 'refunded':
      return 'refunded';
    case 'failed':
      return 'failed';
    default:
      return status || 'unknown';
  }
}

function mapWooFulfillmentStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'completed':
      return 'fulfilled';
    case 'cancelled':
    case 'canceled':
    case 'trash':
      return 'canceled';
    default:
      return 'not_fulfilled';
  }
}

function firstWooShippingTitle(order) {
  const lines = Array.isArray(order.shipping_lines) ? order.shipping_lines : [];
  return lines[0]?.method_title || lines[0]?.method_id || null;
}

function firstWooProductName(lineItems) {
  return lineItems[0]?.name || null;
}

function firstWooVariant(lineItems) {
  const item = lineItems[0];
  if (!item) return null;
  const meta = Array.isArray(item.meta_data) ? item.meta_data : [];
  const parts = meta
    .filter(m => m && m.display_key && m.display_value)
    .map(m => `${m.display_key}: ${m.display_value}`);
  if (parts.length) return parts.join(', ');
  return item.sku || null;
}

function wooTimestamp(gmtValue, localValue) {
  if (gmtValue) {
    const raw = String(gmtValue).trim();
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
    return `${raw}Z`;
  }
  return localValue || null;
}
