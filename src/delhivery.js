export function mapWixOrderToDelhivery(order, config, options = {}) {
  const destination = order?.shippingInfo?.logistics?.shippingDestination;
  const address = destination?.address || order?.billingInfo?.address || {};
  const contact = destination?.contactDetails || order?.billingInfo?.contactDetails || {};
  const country = address.country || 'IN';
  if (isInternationalCountry(country)) {
    return mapWixOrderToInternationalDelhivery(order, config, options);
  }

  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];
  const shippableItems = lineItems.filter(item => item?.itemType?.preset !== 'DIGITAL');
  const items = shippableItems.length ? shippableItems : lineItems;
  const totalAmount = amount(order?.priceSummary?.total?.amount) || sumLineItems(items);
  const paymentMode = options.reverse ? 'Pickup' : inferPaymentMode(order, config);
  const codAmount = paymentMode === 'COD' ? totalAmount : 0;
  const orderId = order?.number ? `${order.number}` : `${order?.id}`;
  validateSupportedDestination(address);

  const shipment = removeEmpty({
    name: fullName(contact),
    add: formatAddress(address),
    city: address.city,
    state: normalizeSubdivision(address.subdivision || address.subdivisionFullname),
    country,
    pin: address.postalCode,
    phone: contact.phone,
    order: orderId,
    payment_mode: paymentMode,
    cod_amount: codAmount,
    total_amount: totalAmount,
    quantity: items.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1,
    products_desc: describeProducts(items),
    shipment_width: config.defaults.widthCm,
    shipment_height: config.defaults.heightCm,
    shipment_length: config.defaults.lengthCm,
    weight: config.defaults.weightGrams,
    seller_gst_tin: config.defaults.sellerGstTin,
    hsn_code: config.defaults.hsnCode,
    md: config.defaults.shippingMode,
    shipping_mode: shippingModeLabel(config.defaults.shippingMode),
    shipment_mode: shippingModeLabel(config.defaults.shippingMode),
    return_name: options.reverse ? config.delhivery.returnName : undefined,
    return_add: options.reverse ? config.delhivery.returnAddress : undefined,
    return_city: options.reverse ? config.delhivery.returnCity : undefined,
    return_state: options.reverse ? config.delhivery.returnState : undefined,
    return_pin: options.reverse ? config.delhivery.returnPincode : undefined,
    return_phone: options.reverse ? config.delhivery.returnPhone : undefined
  });

  return {
    shipments: [sanitizeShipment(shipment)],
    pickup_location: {
      name: config.delhivery.pickupLocation
    }
  };
}

export function mapWixOrderToInternationalDelhivery(order, config, options = {}) {
  const destination = order?.shippingInfo?.logistics?.shippingDestination;
  const address = destination?.address || order?.billingInfo?.address || {};
  const contact = destination?.contactDetails || order?.billingInfo?.contactDetails || {};
  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : [];
  const shippableItems = lineItems.filter(item => item?.itemType?.preset !== 'DIGITAL');
  const items = shippableItems.length ? shippableItems : lineItems;
  const totalAmount = amount(order?.priceSummary?.total?.amount) || sumLineItems(items);
  const shippingMethod = getWixShippingMethod(order);
  const service = normalizeInternationalService(options.internationalService) || mapWixShippingToInternationalService(shippingMethod);

  return {
    flow: 'international',
    status: 'pending-zone',
    awbCreation: 'disabled',
    order: {
      id: order?.id || '',
      number: order?.number || ''
    },
    customer: removeEmpty({
      name: fullName(contact),
      phone: contact.phone,
      email: order?.buyerInfo?.email,
      address: formatAddress(address),
      city: address.city,
      state: normalizeSubdivision(address.subdivision || address.subdivisionFullname),
      postalCode: address.postalCode,
      country: address.country,
      countryFullname: address.countryFullname
    }),
    shipment: {
      type: config.defaults.internationalShipmentType,
      service,
      wixShippingMethod: shippingMethod,
      totalAmount,
      currency: order?.currency || 'INR',
      quantity: items.reduce((sum, item) => sum + Number(item.quantity || 1), 0) || 1,
      weightGrams: config.defaults.weightGrams,
      dimensionsCm: {
        length: config.defaults.lengthCm,
        width: config.defaults.widthCm,
        height: config.defaults.heightCm
      }
    },
    items: items.map(item =>
      removeEmpty({
        name: item?.productName?.original || item?.productName?.translated || item?.name || 'Item',
        sku: item?.physicalProperties?.sku,
        hsnCode: config.defaults.hsnCode,
        quantity: Number(item?.quantity || 1),
        price: amount(item?.totalPriceAfterTax?.amount) || amount(item?.price?.amount)
      })
    ),
    pickup_location: {
      name: config.delhivery.pickupLocation
    }
  };
}

export async function createDelhiveryOrder(payload, config) {
  validateDelhiveryConfig(config);
  validatePayload(payload);

  const body = `format=json&data=${JSON.stringify(payload)}`;

  const response = await fetch(config.delhivery.createOrderUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${config.delhivery.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body
  });

  const responseBody = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Delhivery create order failed (${response.status}): ${JSON.stringify(responseBody)}`);
  }
  if (isDelhiveryFailure(responseBody)) {
    throw new Error(formatDelhiveryError(responseBody));
  }

  return responseBody;
}

export async function calculateDelhiveryCharge({ destinationPincode, weightGrams, mode, status }, config) {
  if (!config.delhivery.token) throw new Error('DELHIVERY_API_TOKEN is required.');
  if (!config.delhivery.pickupPincode) throw new Error('DELHIVERY_PICKUP_PINCODE is required for rate checks.');
  if (!destinationPincode) throw new Error('destinationPincode is required.');

  const url = new URL(config.delhivery.invoiceUrl);
  url.searchParams.set('md', mode || config.defaults.shippingMode);
  url.searchParams.set('cgm', String(weightGrams || config.defaults.weightGrams));
  url.searchParams.set('o_pin', config.delhivery.pickupPincode);
  url.searchParams.set('d_pin', destinationPincode);
  url.searchParams.set('ss', status || 'Delivered');

  const response = await fetch(url, {
    headers: {
      Authorization: `Token ${config.delhivery.token}`,
      Accept: 'application/json'
    }
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Delhivery charge check failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export function calculateInternationalCharge({ country, weightGrams, service }, config) {
  const selectedService = normalizeInternationalService(service) || 'DLV Saver';
  const rateCard = config.defaults.internationalRateCard || {};
  const countryRates = rateCard[country] || rateCard[String(country || '').toUpperCase()] || rateCard.DEFAULT || {};
  const slabs = countryRates[selectedService] || countryRates.DEFAULT || [];
  const weight = Number(weightGrams || config.defaults.weightGrams);
  const selectedSlab = slabs.find(slab => weight <= Number(slab.uptoGrams || slab.upto || 0));

  if (!selectedSlab) {
    return {
      service: selectedService,
      country,
      weightGrams: weight,
      available: false,
      message: 'International Delhivery rate card is not configured for this country/service/weight.'
    };
  }

  return {
    service: selectedService,
    country,
    weightGrams: weight,
    available: true,
    currency: selectedSlab.currency || 'INR',
    amount: Number(selectedSlab.amount),
    tatDays: selectedSlab.tatDays || selectedSlab.tat || ''
  };
}

export function validatePayload(payload) {
  if (payload?.flow === 'international') {
    validateInternationalPayload(payload);
    return;
  }

  const shipment = payload?.shipments?.[0];
  const missing = [];
  for (const key of ['name', 'add', 'pin', 'phone', 'order', 'payment_mode']) {
    if (!shipment?.[key]) missing.push(key);
  }
  if (shipment?.country === 'IN' && !/^\d{6}$/.test(String(shipment.pin))) {
    throw new Error('Delhivery India shipments require a 6 digit destination pincode.');
  }
  if (shipment?.payment_mode === 'Pickup') {
    for (const key of ['return_name', 'return_add', 'return_city', 'return_state', 'return_pin', 'return_phone']) {
      if (!shipment?.[key]) missing.push(key);
    }
  }
  if (!shipment?.seller_gst_tin) missing.push('seller_gst_tin');
  if (!shipment?.hsn_code) missing.push('hsn_code');
  if (!payload?.pickup_location?.name) missing.push('pickup_location.name');
  if (missing.length) {
    throw new Error(`Missing required Delhivery fields: ${missing.join(', ')}`);
  }
}

export function getWixShippingMethod(order) {
  return (
    order?.shippingInfo?.title ||
    order?.shippingInfo?.logistics?.selectedCarrierServiceOption?.title ||
    order?.shippingInfo?.code ||
    ''
  );
}

export function mapWixShippingToInternationalService(method) {
  const normalized = String(method || '').toLowerCase();
  if (normalized.includes('express')) return 'Deferred Express';
  if (normalized.includes('standard')) return 'DLV Saver';
  return 'DLV Saver';
}

export function normalizeInternationalService(service) {
  const normalized = String(service || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('express')) return 'Deferred Express';
  if (normalized.includes('saver') || normalized.includes('standard')) return 'DLV Saver';
  return '';
}

function validateDelhiveryConfig(config) {
  const missing = [];
  if (!config.delhivery.token) missing.push('DELHIVERY_API_TOKEN');
  if (!config.delhivery.pickupLocation) missing.push('DELHIVERY_PICKUP_LOCATION');
  if (missing.length) {
    throw new Error(`Missing Delhivery configuration: ${missing.join(', ')}`);
  }
}

function inferPaymentMode(order, config) {
  const explicit = order?.customFields?.find?.(field => field.name === 'payment_mode')?.value;
  if (explicit === 'COD' || explicit === 'Pre-paid') return explicit;

  if (order?.paymentOption === 'FULL_PAYMENT_OFFLINE') return 'COD';
  if (order?.paymentStatus === 'NOT_PAID') return 'COD';
  return config.defaults.paymentMode === 'COD' ? 'COD' : 'Prepaid';
}

function fullName(contact) {
  return compact([contact.firstName, contact.lastName]).join(' ') || contact.company || 'Customer';
}

function formatAddress(address) {
  const streetAddress = address.streetAddress
    ? compact([address.streetAddress.name, address.streetAddress.number, address.streetAddress.apt]).join(', ')
    : '';
  return compact([address.addressLine, address.addressLine2, streetAddress]).join(', ');
}

function validateSupportedDestination(address) {
  const country = address.country || 'IN';
  if (!['IN', 'BD'].includes(country)) {
    throw new Error(
      `Delhivery Express order creation supports India shipments by default and Bangladesh when enabled. This Wix order ships to ${country}, so it needs a different/international shipping flow.`
    );
  }
}

function validateInternationalPayload(payload) {
  const missing = [];
  for (const key of ['name', 'phone', 'address', 'city', 'postalCode', 'country']) {
    if (!payload?.customer?.[key]) missing.push(`customer.${key}`);
  }
  if (!payload?.shipment?.service) missing.push('shipment.service');
  if (!payload?.pickup_location?.name) missing.push('pickup_location.name');
  if (!payload?.items?.length) missing.push('items');
  if (missing.length) {
    throw new Error(`Missing required international shipment fields: ${missing.join(', ')}`);
  }
}

function isInternationalCountry(country) {
  return !['IN', 'BD'].includes(country || 'IN');
}

function describeProducts(items) {
  return items
    .map(item => {
      const name = item?.productName?.original || item?.productName?.translated || item?.name || 'Item';
      const sku = item?.physicalProperties?.sku ? ` ${item.physicalProperties.sku}` : '';
      return `${name}${sku} x${item?.quantity || 1}`;
    })
    .join(', ')
    .slice(0, 250);
}

function normalizeSubdivision(value) {
  if (!value) return '';
  return String(value).replace(/^IN-/, '');
}

function shippingModeLabel(mode) {
  return mode === 'S' ? 'Surface' : 'Express';
}

function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumLineItems(items) {
  return items.reduce((sum, item) => {
    const itemTotal =
      amount(item?.totalPriceAfterTax?.amount) ||
      amount(item?.totalPriceBeforeTax?.amount) ||
      amount(item?.price?.amount) * Number(item?.quantity || 1);
    return sum + itemTotal;
  }, 0);
}

function compact(values) {
  return values.filter(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function sanitizeShipment(shipment) {
  const blocked = /[&#%;\\]/g;
  return Object.fromEntries(
    Object.entries(shipment).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(blocked, ' ').replace(/\s+/g, ' ').trim() : value
    ])
  );
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

function isDelhiveryFailure(body) {
  if (body?.success === false) return true;
  if (Array.isArray(body?.packages)) {
    return body.packages.some(pkg => String(pkg?.status || '').toLowerCase() === 'fail');
  }
  return false;
}

function formatDelhiveryError(body) {
  const details = body?.rmk || body?.message || JSON.stringify(body);
  if (String(details).includes("NoneType' object has no attribute 'end_date'")) {
    return [
      `Delhivery rejected shipment: ${details}`,
      'Likely cause: the Delhivery client/contract is not active or not mapped in the selected environment.',
      'Check DELHIVERY_ENV, DELHIVERY_CLIENT_NAME, DELHIVERY_PICKUP_LOCATION, and whether Delhivery has enabled this account for API order creation.'
    ].join(' ');
  }
  return `Delhivery rejected shipment: ${JSON.stringify(body)}`;
}

export function mapAmazonOrderToDelhivery(amazonPayload, config, options = {}) {
  const { order, address, buyer, items } = amazonPayload;
  const country = address?.CountryCode || 'IN';

  const totalAmount = Number(order?.OrderTotal?.Amount || 0);
  const paymentMode = 'Prepaid';
  const codAmount = 0;
  const orderId = order?.AmazonOrderId || '';

  const streetAddress = [address?.AddressLine1 || '', address?.AddressLine2 || ''].filter(Boolean).join(', ');

  const shipment = removeEmpty({
    name: address?.Name || buyer?.BuyerName || 'Amazon Customer',
    add: streetAddress,
    city: address?.City || '',
    state: normalizeSubdivision(address?.StateOrRegion || ''),
    country,
    pin: address?.PostalCode || '',
    phone: address?.Phone || '',
    order: orderId,
    payment_mode: paymentMode,
    cod_amount: codAmount,
    total_amount: totalAmount,
    quantity: (items || []).reduce((sum, item) => sum + Number(item.QuantityOrdered || 1), 0) || 1,
    products_desc: (items || []).map(item => item.Title || 'Amazon Product').join(', ').slice(0, 250),
    shipment_width: config.defaults.widthCm,
    shipment_height: config.defaults.heightCm,
    shipment_length: config.defaults.lengthCm,
    weight: config.defaults.weightGrams,
    seller_gst_tin: config.defaults.sellerGstTin,
    hsn_code: config.defaults.hsnCode,
    md: config.defaults.shippingMode,
    shipping_mode: shippingModeLabel(config.defaults.shippingMode),
    shipment_mode: shippingModeLabel(config.defaults.shippingMode),
    return_name: options.reverse ? config.delhivery.returnName : undefined,
    return_add: options.reverse ? config.delhivery.returnAddress : undefined,
    return_city: options.reverse ? config.delhivery.returnCity : undefined,
    return_state: options.reverse ? config.delhivery.returnState : undefined,
    return_pin: options.reverse ? config.delhivery.returnPincode : undefined,
    return_phone: options.reverse ? config.delhivery.returnPhone : undefined
  });

  return {
    shipments: [sanitizeShipment(shipment)],
    pickup_location: {
      name: config.delhivery.pickupLocation
    }
  };
}

