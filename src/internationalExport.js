export function buildInternationalShipmentWorkbook(orders, config) {
  const rows = orders.map(order => buildInternationalShipmentRow(order, config));

  const sheetRows = [
    INTERNATIONAL_EXPORT_HEADERS,
    ...rows.map(row => INTERNATIONAL_EXPORT_HEADERS.map(header => row[header] ?? ''))
  ];

  return createXlsxWorkbook('Sample Sheet', sheetRows);
}

export function buildInternationalShipmentRow(order, config) {
  const raw = order.raw_order || {};
  const destination = raw?.shippingInfo?.logistics?.shippingDestination || {};
  const address = destination.address || {};
  const contact = destination.contactDetails || {};
  const buyer = raw.buyerInfo || {};
  const items = raw.lineItems || [];
  const defaults = config.defaults || {};
  const delhivery = config.delhivery || {};
  const invoiceValue = order.total_amount || moneyAmount(raw?.priceSummary?.total?.amount || raw?.priceSummary?.totalPrice?.amount);
  const shippingCharge = order.shipping_amount || moneyAmount(raw?.priceSummary?.shipping?.amount) || 0;
  const weight = Math.max(
    Number(defaults.weightGrams || 0),
    items.reduce((sum, item) => sum + Number(item?.physicalProperties?.weight || 0) * 1000 * Number(item.quantity || 1), 0)
  );
  const exportItem = holdMyThrottleItem(items);
  const exportSku = exportItem?.physicalProperties?.sku || '';
  const quantity = 1;
  const unitPrice = invoiceValue || moneyAmount(exportItem?.price?.amount || exportItem?.lineItemPrice?.amount) || 0;
  const consigneeName = contactName(contact) || order.customers?.name || '';
  const consigneeAddress = [
    address.addressLine || formatStreetAddress(address.streetAddress),
    address.addressLine2
  ].filter(Boolean).join(', ');
  const orderNumber = order.order_number || raw.number || '';
  const invoiceNumber = orderNumber || order.wix_order_id || raw.id || '';
  const invoiceDate = dateOnly(order.source_created_at || raw.createdDate || raw._createdDate || raw.dateCreated);
  const weightGrams = weight || defaults.weightGrams || '';
  const weightKg = weightGrams ? roundTo(weightGrams / 1000, 3) : '';

  return {
    'Order No': orderNumber,
    'Pickup Facility Name': delhivery.pickupLocation || '',
    'Consignee Name': consigneeName,
    'Street Address 1': address.addressLine || formatStreetAddress(address.streetAddress) || '',
    'Street Address 2': address.addressLine2 || '',
    'Consignee City': address.city || '',
    'Consignee State/Province Code': stateProvinceCode(address.subdivision || address.subdivisionFullname || ''),
    'Consignee Pincode': address.postalCode || '',
    'Consignee Phone': order.customers?.phone || contact.phone || '',
    'Consignee Email': order.customers?.email || buyer.email || '',
    'VAT Number': '',
    'IOSS Number': '',
    'Invoice No': invoiceNumber,
    'Invoice Date (YYYY-MM-DD)': invoiceDate,
    'Purpose of Booking': defaults.internationalPurposeOfBooking || 'Gift',
    'Terms of Invoice (Inco Terms)': defaults.invoiceTerms || 'FOB',
    Currency: order.currency || raw.currency || 'INR',
    'Box Number': 1,
    'Length (cm)': defaults.lengthCm || '',
    'Breadth (cm)': defaults.widthCm || '',
    'Height (cm)': defaults.heightCm || '',
    'Box Weight (Kg)': weightKg,
    'Product Category': defaults.internationalProductCategory || '',
    'Product Description': 'Hold My Throttle',
    Quantity: quantity,
    'Unit Price': unitPrice,
    'Product Amount': unitPrice * quantity,
    'Item Unit Weight Kg': weightKg,
    'HSN Code': defaults.hsnCode || '',
    'HTS Code': defaults.htsCode || '',
    'Product ID': exportSku,
    SKUs: exportSku,
    Reference: `Wix ${orderNumber || raw.id || ''}`
  };
}

export function internationalExportFilename(orders) {
  const date = new Date().toISOString().slice(0, 10);
  if (orders.length === 1) {
    return `international-shipment-${safeFilenamePart(orders[0].order_number || orders[0].wix_order_id || date)}.xlsx`;
  }
  return `international-shipments-${date}.xlsx`;
}

function createXlsxWorkbook(sheetName, rows) {
  return createZip([
    {
      name: '[Content_Types].xml',
      content: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        '</Types>'
      ].join('')
    },
    {
      name: '_rels/.rels',
      content: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
        '</Relationships>'
      ].join('')
    },
    {
      name: 'xl/workbook.xml',
      content: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        '<sheets>',
        `<sheet name="${escapeXmlAttribute(sheetName)}" sheetId="1" r:id="rId1"/>`,
        '</sheets>',
        '</workbook>'
      ].join('')
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
        '</Relationships>'
      ].join('')
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: renderWorksheet(rows)
    }
  ]);
}

function renderWorksheet(rows) {
  const maxColumns = Math.max(1, ...rows.map(row => row.length));
  const dimension = `A1:${columnName(maxColumns)}${Math.max(1, rows.length)}`;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<dimension ref="${dimension}"/>`,
    '<sheetData>',
    ...rows.map((row, rowIndex) => renderXlsxRow(row, rowIndex + 1)),
    '</sheetData>',
    '</worksheet>'
  ].join('');
}

function renderXlsxRow(values, rowNumber) {
  return `<row r="${rowNumber}">${values.map((value, index) => renderXlsxCell(value, rowNumber, index + 1)).join('')}</row>`;
}

function renderXlsxCell(value, rowNumber, columnNumber) {
  const ref = `${columnName(columnNumber)}${rowNumber}`;
  const text = String(value ?? '');
  const isNumeric = text !== '' && Number.isFinite(Number(text)) && !/^0\d+/.test(text);
  if (isNumeric) return `<c r="${ref}"><v>${text}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

function columnName(columnNumber) {
  let name = '';
  let current = columnNumber;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function internationalServiceForOrder(order, defaults) {
  const bookedService = normalizeInternationalExportService(order.shipment_service_mode || order.shipment_service_code);
  if (bookedService) return bookedService;
  const title = String(order.selected_shipping_title || order.raw_order?.shippingInfo?.title || '').toLowerCase();
  if (title.includes('saver') || title.includes('standard')) return 'DLV Saver';
  if (title.includes('express')) return 'Deferred Express';
  return defaults.internationalShipmentType || 'Commercial';
}

function normalizeInternationalExportService(service) {
  const normalized = String(service || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('saver') || normalized === 'dlv_saver') return 'DLV Saver';
  if (normalized.includes('deferred') || normalized.includes('express') || normalized === 'deferred_express') {
    return 'Deferred Express';
  }
  return service;
}

function itemName(item) {
  return item?.productName?.original || item?.productName?.translated || item?.name || '';
}

function holdMyThrottleItem(items) {
  return items.find(item => itemName(item).toLowerCase().includes('hold my throttle')) || items[0] || null;
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

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function dateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function stateProvinceCode(value) {
  return String(value || '').replace(/^[A-Z]{2}-/, '');
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, char => {
    const entities = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };
    return entities[char];
  });
}

function escapeXmlAttribute(value) {
  return escapeXml(value);
}

function safeFilenamePart(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'order';
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

export const INTERNATIONAL_EXPORT_HEADERS = [
  'Order No',
  'Pickup Facility Name',
  'Consignee Name',
  'Street Address 1',
  'Street Address 2',
  'Consignee City',
  'Consignee State/Province Code',
  'Consignee Pincode',
  'Consignee Phone',
  'Consignee Email',
  'VAT Number',
  'IOSS Number',
  'Invoice No',
  'Invoice Date (YYYY-MM-DD)',
  'Purpose of Booking',
  'Terms of Invoice (Inco Terms)',
  'Currency',
  'Box Number',
  'Length (cm)',
  'Breadth (cm)',
  'Height (cm)',
  'Box Weight (Kg)',
  'Product Category',
  'Product Description',
  'Quantity',
  'Unit Price',
  'Product Amount',
  'Item Unit Weight Kg',
  'HSN Code',
  'HTS Code',
  'Product ID'
];
