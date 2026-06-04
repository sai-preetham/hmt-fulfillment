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
  const responsePackage = record.delhiveryResponse?.packages?.[0] || {};
  const direction = record.reverse ? 'reverse' : payloadShipment.payment_mode === 'Pickup' ? 'reverse' : 'forward';
  const service = international
    ? normalizeServiceCode(record.internationalService || record.requestPayload?.shipment?.service)
    : normalizeDomesticService(record.shippingMode || payloadShipment.md);

  return {
    order_id: record.dbOrderId || null,
    legacy_order_id: record.orderId || null,
    order_number: record.orderNumber || payloadShipment.order || null,
    direction,
    flow: international ? 'international' : 'domestic',
    courier_code: record.courierCode || 'delhivery',
    courier_service_code: service,
    service_mode: international ? record.requestPayload?.shipment?.service || null : payloadShipment.shipping_mode || null,
    status: record.status || 'pending',
    waybill: record.waybill || responsePackage.waybill || null,
    upload_wbn: record.delhiveryResponse?.upload_wbn || null,
    pickup_location: record.requestPayload?.pickup_location?.name || null,
    length_cm: numberAmount(payloadShipment.shipment_length || record.requestPayload?.shipment?.dimensionsCm?.length),
    width_cm: numberAmount(payloadShipment.shipment_width || record.requestPayload?.shipment?.dimensionsCm?.width),
    height_cm: numberAmount(payloadShipment.shipment_height || record.requestPayload?.shipment?.dimensionsCm?.height),
    weight_grams: numberAmount(payloadShipment.weight || record.requestPayload?.shipment?.weightGrams),
    cod_amount: numberAmount(payloadShipment.cod_amount),
    request_payload: record.requestPayload || {},
    carrier_response: record.delhiveryResponse || null,
    error: record.error || null,
    message: record.message || null
  };
}

export function buildOrderShipmentSummary(shipment, observedAt = new Date().toISOString()) {
  const shipmentUpdatedAt = shipment.updated_at || observedAt;
  const waybill = shipment.waybill || shipment.upload_wbn || null;

  return {
    shipment_status: shipment.status || null,
    shipment_waybill: waybill,
    shipment_courier_code: shipment.courier_code || null,
    shipment_service_code: shipment.courier_service_code || null,
    shipment_service_mode: shipment.service_mode || null,
    shipment_booked_at: shipment.status === 'booked' && waybill ? shipmentUpdatedAt : null,
    shipment_updated_at: shipmentUpdatedAt,
    updated_at: observedAt
  };
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
  if (normalized.includes('saver')) return 'dlv_saver';
  if (normalized.includes('express')) return 'deferred_express';
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
}

function redactPaymentSecrets(value) {
  const json = JSON.stringify(value || {});
  return JSON.parse(
    json.replace(/"([^"]*(?:card|cvv|account|upi|password|secret)[^"]*)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
  );
}
