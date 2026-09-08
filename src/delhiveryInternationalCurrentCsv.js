const PREMIUM_HEADERS = [
  'waybill', 'order_no*^', 'client_name*^', 'weight*^', 'length*^', 'breadth*^', 'height*^', 'service_type*^', 'type_of_shipment*^', 'invoice_no*^', 'invoice_date*^', 'currency*^', 'invoice_terms*^', 'igst_payment_status', 'lut_bond_reference', 'shipping_charge', 'insurance_charge', 'product_description*^', 'contains_artificial_jewellery', 'hsn_code*^', 'export_using_ecommerce', 'RODTEP', 'commodity_under_3c', 'product_quantity*^', 'unit_price*^', 'product_amount*^', 'item_commodity_value*^', 'total_commodity_value*^', 'igst_rate', 'igst_amount', 'total_amount*^', 'package_amount*^', 'payment_mode*^', 'cod_amount', 'billing_mode', 'battery*', 'transaction_type*^', 'consignee_id', 'consignee_name*^', 'consignee_email^', 'consignee_phone*^', 'consignee_iec', 'consignee_address_type', 'consignee_address*^', 'consignee_city*^', 'consignee_state/province_code*^', 'consignee_country*^', 'consignee_pincode*^', 'drop_warehouse_id', 'seller_ID', 'shipper_name*^', 'shipper_email', 'shipper_contact*^', 'shipper_address_type', 'shipper_address*^', 'shipper_city*^', 'shipper_state*^', 'shipper_country*^', 'shipper_pincode*^', 'shipper_IEC', 'shipeer_GSTIN', 'shipper_PAN', 'shipper_bank_AD_code', 'shipper_bank_IFSC', 'shipper_Bank_Account_No', 'eor_name', 'eor_phone', 'eor_postal', 'ior_name', 'ior_phone', 'ior_postal', 'pickup_warehouse_ID*^', 'pickup_country*^', 'return_address', 'return_pin', 'clearance_mode', 'ioss_value', 'No_of_Pieces', 'MPS_Amount', 'Master_Waybill', 'EWBN', 'no_of_items', 'box_weights*^'
];

const SAVER_HEADERS = [
  'Order No', 'Pickup Facility Name', 'Destination Country', 'Terms of Invoice (Inco Terms)', 'Consignee Name', 'Street Address 1', 'Street Address 2', 'Consignee City', 'Consignee State/Province Code', 'Consignee Pincode', 'Consignee Phone', 'Consignee Email', 'Bill To Same as Ship To', 'Bill To Name', 'Bill To Street Address 1', 'Bill To Street Address 2', 'Bill To City', 'Bill To State/Province Code', 'Bill To Pincode', 'Bill To Country', 'Bill To Phone', 'Bill To Email', 'Export Using E-Commerce', 'VAT Number', 'IOSS Number', 'Invoice No', 'Invoice Date (YYYY-MM-DD)', 'IGST Payment Status', 'LUT/Bond Number', 'Currency', 'Insurance Value', 'Freight Value', 'Box Number', 'Length (cm)', 'Breadth (cm)', 'Height (cm)', 'Box Weight (Kg)', 'Product Description', 'Product Category', 'Quantity', 'Unit Price', 'Product Amount', 'IGST Rate', 'IGST Amount', 'Total Amount (Including IGST)', 'Item Unit Weight Kg', 'HSN Code', 'HTS Code', 'Purpose of Booking', 'Product ID'
];

const COUNTRY_CODES = { US: 'US', AUSTRALIA: 'AU', AU: 'AU', GERMANY: 'DE', DE: 'DE', SWEDEN: 'SE', SE: 'SE' };

export const DELHIVERY_CURRENT_TEMPLATE_PROFILES = {
  premium: { headers: PREMIUM_HEADERS, serviceType: 'EXPORTS_EXPRESS', downloadedFrom: 'Delhivery One, 2026-07-23, CSB V; Sweden DLV Premium sample refreshed 2026-07-23' },
  saver: {
    US: { headers: SAVER_HEADERS, downloadedFrom: 'Delhivery One, 2026-07-23, CSB V' },
    AU: { headers: SAVER_HEADERS, downloadedFrom: 'Delhivery One, 2026-07-23, CSB V' },
    DE: { headers: SAVER_HEADERS.filter(header => header !== 'Street Address 2'), downloadedFrom: 'Delhivery One, 2026-07-23, CSB V' }
  }
};

export function buildDelhiveryInternationalCurrentCsv(orders, config = {}, options = {}) {
  const service = normalizeService(options.service || 'saver');
  const countryCode = normalizeCountry(options.country || options.destinationCountry);
  const profile = getDelhiveryCurrentTemplateProfile({ service, country: countryCode });
  const rows = orders.map(order => buildRow(order, config, { service, countryCode, headers: profile.headers }));
  const issues = rows.flatMap(({ issues }, rowIndex) => issues.map(issue => ({ ...issue, row: rowIndex + 2 })));
  const csv = [profile.headers, ...rows.map(({ row }) => profile.headers.map(header => row[header] ?? ''))]
    .map(values => values.map(csvCell).join(','))
    .join('\r\n');
  return { csv: `${csv}\r\n`, issues, profile: { service, country: countryCode, headers: profile.headers } };
}

export function getDelhiveryCurrentTemplateProfile({ service = 'saver', country } = {}) {
  const normalizedService = normalizeService(service);
  const countryCode = normalizeCountry(country);
  if (normalizedService === 'premium') return { ...DELHIVERY_CURRENT_TEMPLATE_PROFILES.premium, country: countryCode };
  const profile = DELHIVERY_CURRENT_TEMPLATE_PROFILES.saver[countryCode];
  if (!profile) throw new Error(`No freshly downloaded DLV Saver template profile for ${countryCode}. Download that country/service template from Delhivery One before exporting.`);
  return { ...profile, service: normalizedService, country: countryCode };
}

export function delhiveryInternationalCurrentCsvFilename(orders, { service = 'saver', country } = {}) {
  const date = new Date().toISOString().slice(0, 10);
  const orderPart = orders.length === 1 ? safeFilenamePart(orders[0].order_number || orders[0].wix_order_id || date) : date;
  return `delhivery-${normalizeService(service)}-${normalizeCountry(country).toLowerCase()}-csbv-${orderPart}.csv`;
}

function buildRow(order, config, { service, countryCode, headers }) {
  const raw = order.raw_order || {};
  const destination = raw?.shippingInfo?.logistics?.shippingDestination || {};
  const address = destination.address || order.shipping_address || {};
  const contact = destination.contactDetails || {};
  const buyer = raw.buyerInfo || {};
  const items = raw.lineItems || [];
  const item = items[0] || {};
  const settings = internationalSettings(config);
  const orderNumber = order.order_number || raw.number || order.wix_order_id || '';
  const invoiceNumber = order.invoice_number || orderNumber;
  const invoiceDate = dateOnly(order.source_created_at || raw.createdDate || raw._createdDate || raw.dateCreated);
  const quantity = 1;
  const productAmount = totalGoodsValue(items);
  const unitPrice = productAmount;
  const weightGrams = packageWeightGrams(order, item, settings);
  const weightKg = weightGrams === '' ? '' : round(weightGrams / 1000, 3);
  const consignee = {
    name: order.customers?.name || contactName(contact) || address.name || '',
    email: order.customers?.email || buyer.email || contact.email || '',
    phone: internationalPhone(order.customers?.phone || contact.phone || address.phone || ''),
    line1: asciiAddress(address.addressLine || address.address_line1 || address.streetAddress || ''),
    line2: asciiAddress(address.addressLine2 || address.address_line2 || ''),
    city: asciiAddress(address.city || ''),
    state: asciiAddress(address.state || address.subdivision || address.subdivisionFullname || ''),
    pincode: address.postalCode || address.postal_code || ''
  };
  const productDescription = settings.productDescription || productDescriptions(items) || 'Hold My Throttle';
  const common = {
    orderNumber, invoiceNumber, invoiceDate, quantity, unitPrice, productAmount, weightGrams, weightKg, consignee, productDescription,
    productId: items.map(lineItemSku).filter(Boolean).join('; '), itemCount: totalItemCount(items), settings, countryCode
  };
  const row = service === 'premium' ? premiumRow(common) : saverRow(common);
  const issues = validationIssues(row, headers, service, common);
  return { row, issues };
}

function saverRow(data) {
  const { settings, countryCode, consignee } = data;
  return {
    'Order No': data.orderNumber,
    'Pickup Facility Name': settings.pickupFacilityName,
    'Destination Country': countryCode,
    'Terms of Invoice (Inco Terms)': 'FOB',
    'Consignee Name': consignee.name,
    'Street Address 1': consignee.line1,
    'Street Address 2': consignee.line2,
    'Consignee City': consignee.city,
    'Consignee State/Province Code': consignee.state,
    'Consignee Pincode': consignee.pincode,
    'Consignee Phone': consignee.phone,
    'Consignee Email': consignee.email,
    'Bill To Same as Ship To': settings.billToSameAsShipTo || 'Yes',
    'Bill To Name': settings.billToSameAsShipTo === 'No' ? settings.billToName : '',
    'Bill To Street Address 1': settings.billToSameAsShipTo === 'No' ? settings.billToAddress1 : '',
    'Bill To Street Address 2': settings.billToSameAsShipTo === 'No' ? settings.billToAddress2 : '',
    'Bill To City': settings.billToSameAsShipTo === 'No' ? settings.billToCity : '',
    'Bill To State/Province Code': settings.billToSameAsShipTo === 'No' ? settings.billToState : '',
    'Bill To Pincode': settings.billToSameAsShipTo === 'No' ? settings.billToPincode : '',
    'Bill To Country': settings.billToSameAsShipTo === 'No' ? settings.billToCountry : '',
    'Bill To Phone': settings.billToSameAsShipTo === 'No' ? settings.billToPhone : '',
    'Bill To Email': settings.billToSameAsShipTo === 'No' ? settings.billToEmail : '',
    'Export Using E-Commerce': settings.exportUsingEcommerce || 'Yes',
    'VAT Number': settings.vatNumber || '',
    'IOSS Number': settings.iossNumber || '',
    'Invoice No': data.invoiceNumber,
    'Invoice Date (YYYY-MM-DD)': data.invoiceDate,
    'IGST Payment Status': settings.igstPaymentStatus || 'Paid',
    'LUT/Bond Number': settings.lutBondNumber || '',
    Currency: settings.currency || data.currency || 'INR',
    'Insurance Value': settings.insuranceValue || '',
    'Freight Value': settings.freightValue || '',
    'Box Number': 1,
    'Length (cm)': settings.lengthCm,
    'Breadth (cm)': settings.widthCm,
    'Height (cm)': settings.heightCm,
    'Box Weight (Kg)': data.weightKg,
    'Product Description': data.productDescription,
    'Product Category': settings.productCategory || '',
    Quantity: data.quantity,
    'Unit Price': data.unitPrice,
    'Product Amount': data.productAmount,
    'IGST Rate': settings.igstRate || '',
    'IGST Amount': settings.igstAmount || '',
    'Total Amount (Including IGST)': totalWithIgst(data.productAmount, settings),
    'Item Unit Weight Kg': data.weightKg,
    'HSN Code': settings.hsnCode,
    'HTS Code': settings.htsCode || '',
    'Purpose of Booking': 'commercial',
    'Product ID': data.productId
  };
}

function premiumRow(data) {
  const { settings, consignee, countryCode } = data;
  const igstAmount = settings.igstAmount || calculatedIgstAmount(data.productAmount, settings.igstRate);
  const total = totalWithIgst(data.productAmount, settings);
  const shipper = settings.shipper || {};
  return {
    waybill: '', 'order_no*^': data.orderNumber, 'client_name*^': settings.clientName, 'weight*^': data.weightGrams,
    'length*^': settings.lengthCm, 'breadth*^': settings.widthCm, 'height*^': settings.heightCm,
    'service_type*^': 'EXPORTS_EXPRESS', 'type_of_shipment*^': 'commercial', 'invoice_no*^': data.invoiceNumber,
    'invoice_date*^': data.invoiceDate, 'currency*^': settings.currency || 'INR', 'invoice_terms*^': 'FOB',
    igst_payment_status: settings.igstPaymentStatus || 'Paid', lut_bond_reference: settings.lutBondNumber || '',
    shipping_charge: settings.freightValue || '', insurance_charge: settings.insuranceValue || '',
    'product_description*^': data.productDescription, contains_artificial_jewellery: settings.containsArtificialJewellery || 'No',
    'hsn_code*^': settings.hsnCode, export_using_ecommerce: settings.exportUsingEcommerce || 'Yes', RODTEP: settings.rodtep || 'No', commodity_under_3c: settings.commodityUnder3c || '',
    'product_quantity*^': data.quantity, 'unit_price*^': data.unitPrice, 'product_amount*^': data.productAmount,
    'item_commodity_value*^': data.productAmount, 'total_commodity_value*^': data.productAmount, igst_rate: settings.igstRate || '', igst_amount: igstAmount,
    'total_amount*^': total, 'package_amount*^': total, 'payment_mode*^': 'Prepaid', cod_amount: '', billing_mode: settings.billingMode || '',
    'battery*': settings.containsBattery || 'No', 'transaction_type*^': settings.transactionType || 'B2C', consignee_id: '', 'consignee_name*^': consignee.name,
    'consignee_email^': consignee.email, 'consignee_phone*^': consignee.phone, consignee_iec: '', consignee_address_type: settings.consigneeAddressType || 'Residential',
    'consignee_address*^': [consignee.line1, consignee.line2].filter(Boolean).join(', '), 'consignee_city*^': consignee.city, 'consignee_state/province_code*^': consignee.state,
    'consignee_country*^': countryCode, 'consignee_pincode*^': consignee.pincode, drop_warehouse_id: '', seller_ID: settings.sellerId || '',
    'shipper_name*^': shipper.name || '', shipper_email: shipper.email || '', 'shipper_contact*^': shipper.phone || '', shipper_address_type: shipper.addressType || 'Office',
    'shipper_address*^': shipper.address || '', 'shipper_city*^': shipper.city || '', 'shipper_state*^': shipper.state || '', 'shipper_country*^': shipper.country || 'IN',
    'shipper_pincode*^': shipper.pincode || '', shipper_IEC: shipper.iec || '', shipeer_GSTIN: shipper.gstin || '', shipper_PAN: shipper.pan || '',
    shipper_bank_AD_code: shipper.bankAdCode || '', shipper_bank_IFSC: shipper.bankIfsc || '', shipper_Bank_Account_No: shipper.bankAccountNumber || '',
    eor_name: '', eor_phone: '', eor_postal: '', ior_name: '', ior_phone: '', ior_postal: '', 'pickup_warehouse_ID*^': settings.pickupWarehouseId,
    'pickup_country*^': 'IN', return_address: shipper.address || '', return_pin: shipper.pincode || '', clearance_mode: settings.clearanceMode || 'courier',
    ioss_value: settings.iossNumber || '', No_of_Pieces: 1, MPS_Amount: '', Master_Waybill: '', EWBN: settings.ewbn || '', no_of_items: data.itemCount, 'box_weights*^': data.weightGrams
  };
}

function validationIssues(row, headers, service, data) {
  const required = service === 'premium'
    ? ['order_no*^', 'client_name*^', 'weight*^', 'length*^', 'breadth*^', 'height*^', 'invoice_no*^', 'invoice_date*^', 'hsn_code*^', 'consignee_name*^', 'consignee_phone*^', 'consignee_address*^', 'consignee_city*^', 'consignee_country*^', 'consignee_pincode*^', 'pickup_warehouse_ID*^', 'box_weights*^']
    : ['Order No', 'Pickup Facility Name', 'Destination Country', 'Consignee Name', 'Street Address 1', 'Consignee City', 'Consignee Pincode', 'Consignee Phone', 'Invoice No', 'Invoice Date (YYYY-MM-DD)', 'Length (cm)', 'Breadth (cm)', 'Height (cm)', 'Box Weight (Kg)', 'Product Description', 'Quantity', 'Unit Price', 'Product Amount', 'HSN Code'];
  const issues = required.filter(header => headers.includes(header) && blank(row[header])).map(header => ({ level: 'error', field: header, message: `${header} is required for this ${service} template.` }));
  if (service === 'premium' && Number(data.productAmount) >= 50000 && blank(row.EWBN)) issues.push({ level: 'error', field: 'EWBN', message: 'EWBN is required when the commercial consignment value is ₹50,000 or above.' });
  if (service === 'premium' && row['type_of_shipment*^'] === 'commercial') {
    if (blank(row.igst_payment_status)) issues.push({ level: 'error', field: 'igst_payment_status', message: 'IGST payment status is required for a commercial Premium shipment.' });
    if (row.igst_payment_status === 'Paid' && blank(row.igst_rate)) issues.push({ level: 'error', field: 'igst_rate', message: 'IGST rate is required when IGST payment status is Paid.' });
    if (['LUT', 'Bond'].includes(row.igst_payment_status) && blank(row.lut_bond_reference)) issues.push({ level: 'error', field: 'lut_bond_reference', message: 'LUT/Bond reference is required when IGST payment status is LUT or Bond.' });
  }
  if (service === 'premium' && data.countryCode === 'US' && blank(row['consignee_state/province_code*^'])) issues.push({ level: 'error', field: 'consignee_state/province_code*^', message: 'A state/province code is required for US shipments.' });
  if (service === 'premium' && blank(row.seller_ID)) {
    const shipperFields = ['shipper_name*^', 'shipper_contact*^', 'shipper_address*^', 'shipper_city*^', 'shipper_state*^', 'shipper_pincode*^', 'shipper_IEC', 'shipeer_GSTIN', 'shipper_PAN', 'shipper_bank_AD_code', 'shipper_bank_IFSC', 'shipper_Bank_Account_No'];
    for (const field of shipperFields) if (blank(row[field])) issues.push({ level: 'error', field, message: `${field} is required for a commercial Premium shipment unless a Delhivery seller_ID is supplied.` });
  }
  if (service === 'saver' && data.countryCode === 'US' && blank(row['Consignee State/Province Code'])) issues.push({ level: 'error', field: 'Consignee State/Province Code', message: 'A state/province code is required for US shipments.' });
  return issues;
}

function internationalSettings(config) {
  const defaults = config.defaults || {};
  const source = config.delhivery?.international || config.international || {};
  return {
    pickupFacilityName: source.pickupFacilityName || config.delhivery?.pickupLocation || '', pickupWarehouseId: source.pickupWarehouseId || '', clientName: source.clientName || '', sellerId: source.sellerId || '',
    lengthCm: source.lengthCm || defaults.internationalLengthCm || defaults.lengthCm || '', widthCm: source.widthCm || defaults.internationalWidthCm || defaults.widthCm || '', heightCm: source.heightCm || defaults.internationalHeightCm || defaults.heightCm || '',
    currency: source.currency || 'INR', hsnCode: source.hsnCode || defaults.hsnCode || '', htsCode: source.htsCode || defaults.htsCode || '', productCategory: source.productCategory || defaults.internationalProductCategory || '', productDescription: source.productDescription || defaults.internationalProductDescription || '',
    igstPaymentStatus: source.igstPaymentStatus || 'Paid', igstRate: source.igstRate || '', igstAmount: source.igstAmount || '', lutBondNumber: source.lutBondNumber || '', insuranceValue: source.insuranceValue || '', freightValue: source.freightValue || '',
    exportUsingEcommerce: source.exportUsingEcommerce || 'Yes', containsBattery: source.containsBattery || 'No', containsArtificialJewellery: source.containsArtificialJewellery || 'No', transactionType: source.transactionType || 'B2C', consigneeAddressType: source.consigneeAddressType || 'Residential',
    billToSameAsShipTo: source.billToSameAsShipTo || 'Yes', vatNumber: source.vatNumber || '', iossNumber: source.iossNumber || '', ewbn: source.ewbn || '', clearanceMode: source.clearanceMode || 'courier', shipper: source.shipper || {}
  };
}

function normalizeService(value) {
  const normalized = String(value).trim().toLowerCase();
  if (['premium', 'dlv premium', 'dlv-premium'].includes(normalized)) return 'premium';
  if (['saver', 'dlv saver', 'dlv-saver'].includes(normalized)) return 'saver';
  throw new Error(`Unsupported service ${value}. Use premium or saver.`);
}

function normalizeCountry(value) {
  const country = COUNTRY_CODES[String(value || '').trim().toUpperCase()];
  if (!country) throw new Error('A supported destination country is required: US, AU, DE, or SE.');
  return country;
}

function packageWeightGrams(order, item, settings) {
  const provided = order.package_weight_grams || order.fedex_payload?.weightGrams;
  const computed = Number(item?.physicalProperties?.weight || 0) * 1000 * Number(item.quantity || 1);
  return numberOr(provided || computed || settings.weightGrams, '');
}

function totalGoodsValue(items) {
  if (!items.length) return '';
  const values = items.map(item => {
    const quantity = numberOr(item.quantity, 1);
    const total = numberOr(item?.lineItemPrice?.amount, '');
    if (total !== '') return total;
    const unit = numberOr(item?.price?.amount, '');
    return unit === '' ? '' : round(unit * quantity);
  });
  return values.some(value => value === '') ? '' : round(values.reduce((total, value) => total + value, 0));
}

function totalItemCount(items) {
  // Mirror mounts are included in the declared goods, but are accessories rather
  // than separately countable shipment items for this Delhivery export.
  return items
    .filter(item => !isMirrorMount(item))
    .reduce((total, item) => total + numberOr(item.quantity, 1), 0) || 1;
}

function isMirrorMount(item) {
  const name = item?.productName?.original || item?.name || '';
  return /\bmirror\b.*\bmounts?\b/i.test(name);
}

function productDescriptions(items) {
  return [...new Set(items.map(item => item?.productName?.original || item.name).filter(Boolean))].join('; ').slice(0, 150);
}

function lineItemSku(item) { return item?.physicalProperties?.sku || item.sku || ''; }

function asciiAddress(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '');
}

function internationalPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function totalWithIgst(productAmount, settings) {
  if (productAmount === '') return '';
  if (settings.igstAmount !== '') return round(Number(productAmount) + Number(settings.igstAmount));
  if (settings.igstRate !== '') return round(Number(productAmount) * (1 + Number(settings.igstRate) / 100));
  return productAmount;
}

function calculatedIgstAmount(productAmount, igstRate) {
  if (productAmount === '' || igstRate === '') return '';
  return round(Number(productAmount) * Number(igstRate) / 100);
}

function dateOnly(value) { const date = value ? new Date(value) : new Date(); return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 10); }
function contactName(contact = {}) { return [contact.firstName, contact.lastName].filter(Boolean).join(' '); }
function numberOr(value, fallback) { const number = Number(value); return value === '' || value == null || !Number.isFinite(number) ? fallback : number; }
function round(value, places = 2) { const factor = 10 ** places; return Math.round((Number(value) + Number.EPSILON) * factor) / factor; }
function blank(value) { return value === '' || value == null; }
function csvCell(value) { const text = String(value ?? '').replace(/^[=+\-@]/, "'$&"); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function safeFilenamePart(value) { return String(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''); }
