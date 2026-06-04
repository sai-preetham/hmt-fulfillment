export function buildInternationalShipmentWorkbook(orders, config) {
  const rows = orders.map(order => buildInternationalShipmentRow(order, config));
  const headers = [
    'Order Number',
    'Wix Order ID',
    'Service',
    'Customer Name',
    'Email',
    'Phone',
    'Address Line 1',
    'Address Line 2',
    'City',
    'State',
    'Postal Code',
    'Country',
    'Currency',
    'Invoice Value',
    'Payment Status',
    'Weight Grams',
    'Length CM',
    'Width CM',
    'Height CM',
    'Item Count',
    'Product Description',
    'SKUs',
    'HSN Codes',
    'Quantities',
    'Unit Values',
    'Shipping Charged',
    'Reference'
  ];

  return Buffer.from(
    [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="International Shipments">',
      '<Table>',
      renderExcelRow(headers),
      ...rows.map(row => renderExcelRow(headers.map(header => row[header] ?? ''))),
      '</Table>',
      '</Worksheet>',
      '</Workbook>'
    ].join('')
  );
}

export function buildInternationalShipmentRow(order, config) {
  const raw = order.raw_order || {};
  const destination = raw?.shippingInfo?.logistics?.shippingDestination || {};
  const address = destination.address || {};
  const contact = destination.contactDetails || {};
  const buyer = raw.buyerInfo || {};
  const items = raw.lineItems || [];
  const defaults = config.defaults || {};
  const weight = Math.max(
    Number(defaults.weightGrams || 0),
    items.reduce((sum, item) => sum + Number(item?.physicalProperties?.weight || 0) * 1000 * Number(item.quantity || 1), 0)
  );
  const service = internationalServiceForOrder(order, defaults);

  return {
    'Order Number': order.order_number || raw.number || '',
    'Wix Order ID': order.wix_order_id || raw.id || '',
    Service: service,
    'Customer Name': contactName(contact) || order.customers?.name || '',
    Email: order.customers?.email || buyer.email || '',
    Phone: order.customers?.phone || contact.phone || '',
    'Address Line 1': address.addressLine || formatStreetAddress(address.streetAddress) || '',
    'Address Line 2': address.addressLine2 || '',
    City: address.city || '',
    State: address.subdivisionFullname || address.subdivision || '',
    'Postal Code': address.postalCode || '',
    Country: address.country || '',
    Currency: order.currency || raw.currency || '',
    'Invoice Value': order.total_amount || moneyAmount(raw?.priceSummary?.total?.amount || raw?.priceSummary?.totalPrice?.amount),
    'Payment Status': order.payment_status || raw.paymentStatus || '',
    'Weight Grams': weight || defaults.weightGrams || '',
    'Length CM': defaults.lengthCm || '',
    'Width CM': defaults.widthCm || '',
    'Height CM': defaults.heightCm || '',
    'Item Count': items.reduce((sum, item) => sum + Number(item.quantity || 1), 0),
    'Product Description': items.map(itemName).filter(Boolean).join(' | '),
    SKUs: items.map(item => item?.physicalProperties?.sku || '').filter(Boolean).join(' | '),
    'HSN Codes': items.map(() => defaults.hsnCode || '').filter(Boolean).join(' | '),
    Quantities: items.map(item => item.quantity || 1).join(' | '),
    'Unit Values': items.map(item => moneyAmount(item?.price?.amount || item?.lineItemPrice?.amount) || '').join(' | '),
    'Shipping Charged': order.shipping_amount || moneyAmount(raw?.priceSummary?.shipping?.amount),
    Reference: `Wix ${order.order_number || raw.number || raw.id || ''}`
  };
}

export function internationalExportFilename(orders) {
  const date = new Date().toISOString().slice(0, 10);
  if (orders.length === 1) {
    return `international-shipment-${safeFilenamePart(orders[0].order_number || orders[0].wix_order_id || date)}.xls`;
  }
  return `international-shipments-${date}.xls`;
}

function renderExcelRow(values) {
  return `<Row>${values.map(renderExcelCell).join('')}</Row>`;
}

function renderExcelCell(value) {
  const text = String(value ?? '');
  const isNumeric = text !== '' && Number.isFinite(Number(text)) && !/^0\d+/.test(text);
  const type = isNumeric ? 'Number' : 'String';
  return `<Cell><Data ss:Type="${type}">${escapeXml(text)}</Data></Cell>`;
}

function internationalServiceForOrder(order, defaults) {
  const title = String(order.selected_shipping_title || order.raw_order?.shippingInfo?.title || '').toLowerCase();
  if (title.includes('saver') || title.includes('standard')) return 'DLV Saver';
  if (title.includes('express')) return 'Deferred Express';
  return defaults.internationalShipmentType || 'Commercial';
}

function itemName(item) {
  return item?.productName?.original || item?.productName?.translated || item?.name || '';
}

function contactName(contact = {}) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
}

function formatStreetAddress(street = {}) {
  return [street.name, street.number, street.apt].filter(Boolean).join(', ');
}

function moneyAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, char => {
    const entities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };
    return entities[char];
  });
}

function safeFilenamePart(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'order';
}
