import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { getConfig } from '../../src/config.js';

export function buildInvoicePdf(detail, options = {}) {
  const model = buildInvoiceModel(detail);
  if (options.format === 'international-label') return renderInternationalLabelPdf(model);
  return renderWixStylePdf(model);
}

export function invoiceFilename(detail, options = {}) {
  const order = detail.order || {};
  const id = String(order.order_number || order.external_order_id || order.id || 'invoice').replace(/[^a-z0-9_-]+/gi, '-');
  return `${options.format === 'international-label' ? 'international-invoice-label' : 'invoice'}-${id}.pdf`;
}

export function buildInvoiceModel(detail) {
  const order = detail.order || {};
  const payment = detail.payment || {};
  const config = getConfig();
  const sellerGstin = process.env.INVOICE_SELLER_GSTIN || config.defaults?.sellerGstTin || '';
  const shippingAddress = {
    name: order.shipping_name || order.customer_name,
    phone: order.shipping_phone || order.phone,
    line1: order.shipping_address_line1 || order.address_line1,
    line2: order.shipping_address_line2 || order.address_line2,
    city: order.shipping_city || order.city,
    state: order.shipping_state || order.state,
    pincode: order.shipping_pincode || order.pincode,
    country: order.shipping_country || order.country
  };
  const billingAddress = {
    name: order.billing_name || order.customer_name,
    phone: order.billing_phone || order.phone,
    line1: order.billing_address_line1 || order.address_line1,
    line2: order.billing_address_line2 || order.address_line2,
    city: order.billing_city || order.city,
    state: order.billing_state || order.state,
    pincode: order.billing_pincode || order.pincode,
    country: order.billing_country || order.country
  };
  const destinationCountry = shippingAddress.country || billingAddress.country || order.country;
  const isIndia = isIndiaCountry(destinationCountry);
  const sourceItems = invoiceItems(detail, order, config.defaults?.hsnCode || '');
  const grandTotal = amount(order.order_value) || sourceItems.reduce((sum, item) => sum + item.lineTotal, 0) + amount(order.shipping_amount);
  const discount = amount(order.discount_amount) || sourceItems.reduce((sum, item) => sum + item.discount, 0);
  const shippingGross = amount(order.shipping_amount);
  const shippingTax = isIndia ? splitInclusiveTax(shippingGross).taxAmount : 0;
  const shippingTaxable = isIndia ? splitInclusiveTax(shippingGross).taxableValue : shippingGross;
  const items = allocateOrderDiscount(sourceItems, discount).map(item => {
    const lineTotal = roundMoney(Math.max(item.grossBeforeDiscount - item.discount, 0));
    const split = isIndia ? splitInclusiveTax(lineTotal) : { taxableValue: lineTotal, taxAmount: 0 };
    return {
      ...item,
      unitPrice: roundMoney(item.quantity ? item.grossBeforeDiscount / item.quantity : item.grossBeforeDiscount),
      lineTotal,
      taxableValue: split.taxableValue,
      taxAmount: split.taxAmount
    };
  });
  const itemTotals = items.reduce((totals, item) => ({
    grossBeforeDiscount: totals.grossBeforeDiscount + item.grossBeforeDiscount,
    discount: totals.discount + item.discount,
    taxableValue: totals.taxableValue + item.taxableValue,
    taxAmount: totals.taxAmount + item.taxAmount,
    lineTotal: totals.lineTotal + item.lineTotal
  }), { grossBeforeDiscount: 0, discount: 0, taxableValue: 0, taxAmount: 0, lineTotal: 0 });

  return {
    order,
    payment,
    isIndia,
    invoice: {
      number: order.order_number || order.external_order_id || order.id || '',
      date: formatDate(order.order_date || new Date().toISOString()),
      orderDate: formatDate(order.order_date || new Date().toISOString()),
      paymentDate: paymentDate(payment),
      awb: order.awb_number || latestShipmentWaybill(detail.shipments)
    },
    seller: {
      name: process.env.INVOICE_SELLER_NAME || 'BYKR TECH PRIVATE LIMITED',
      address: process.env.INVOICE_SELLER_ADDRESS || 'Bengaluru, Karnataka, India',
      gstin: sellerGstin
    },
    buyer: buyerTaxDetails(order),
    billingAddress,
    shippingAddress,
    items,
    totals: {
      grossBeforeDiscount: roundMoney(itemTotals.grossBeforeDiscount),
      discount: roundMoney(itemTotals.discount),
      shippingGross: roundMoney(shippingGross),
      taxableValue: roundMoney(itemTotals.taxableValue + shippingTaxable),
      taxAmount: roundMoney(itemTotals.taxAmount + shippingTax),
      grandTotal: roundMoney(grandTotal)
    }
  };
}

function invoiceItems(detail, order, defaultHsn = '') {
  if (detail.items?.length) {
    return detail.items.map(item => ({
      name: item.product_name || order.product_variant || 'Product',
      sku: item.sku || '',
      hsn: item.hsn_code || defaultHsn || '',
      quantity: Number(item.quantity || 1),
      grossBeforeDiscount: grossLineAmount(item),
      discount: lineDiscount(item),
      lineTotal: amount(item.total_price || item.item_price)
    }));
  }
  const total = amount(order.order_value);
  const discount = amount(order.discount_amount);
  const gross = total + discount - amount(order.shipping_amount);
  return [{
    name: order.product_variant || order.bike_model || 'Product',
    sku: '',
    hsn: defaultHsn || '',
    quantity: Number(order.quantity || 1),
    grossBeforeDiscount: Math.max(gross, 0),
    discount,
    lineTotal: Math.max(total - amount(order.shipping_amount), 0)
  }];
}

function allocateOrderDiscount(items, discountTotal) {
  const itemDiscount = items.reduce((sum, item) => sum + item.discount, 0);
  if (!discountTotal || itemDiscount >= discountTotal || !items.length) return items;
  const remaining = roundMoney(discountTotal - itemDiscount);
  const grossTotal = items.reduce((sum, item) => sum + item.grossBeforeDiscount, 0) || 1;
  let allocated = 0;
  return items.map((item, index) => {
    const extraDiscount = index === items.length - 1
      ? roundMoney(remaining - allocated)
      : roundMoney(remaining * (item.grossBeforeDiscount / grossTotal));
    allocated += extraDiscount;
    return { ...item, discount: roundMoney(item.discount + extraDiscount) };
  });
}

function grossLineAmount(item) {
  const quantity = Number(item.quantity || 1) || 1;
  const unit = amount(item.item_price);
  const total = amount(item.total_price);
  const discount = lineDiscount(item);
  if (unit) return roundMoney(unit * quantity);
  return roundMoney(total + discount);
}

function lineDiscount(item) {
  const raw = item.raw_line_item || {};
  return amount(
    raw.discount?.amount ||
    raw.discountAmount?.amount ||
    raw.totalDiscount?.amount ||
    raw.priceData?.discount?.amount ||
    item.tax_info?.discount?.amount
  );
}

function buyerTaxDetails(order = {}) {
  const rawVat = findVatId(order.raw_order);
  return {
    gstin: order.buyer_gst || rawVat.id || '',
    gstType: order.buyer_gst_type || rawVat.type || ''
  };
}

function findVatId(value) {
  if (!value || typeof value !== 'object') return { id: '', type: '' };
  const candidates = [
    value.billingInfo?.contactDetails?.vatId,
    value.billingInfo?.vatId,
    value.buyerInfo?.vatId,
    value.contactDetails?.vatId,
    value.vatId
  ];
  for (const candidate of candidates) {
    const id = typeof candidate === 'string' ? candidate : candidate?.id || candidate?.value || candidate?.number;
    if (id) return { id, type: typeof candidate === 'object' ? candidate.type || candidate.name || 'VAT' : 'VAT' };
  }
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object') {
      const found = findVatId(nested);
      if (found.id) return found;
    }
  }
  return { id: '', type: '' };
}

function addressLines(address) {
  return [
    address.name || 'Not provided',
    `Phone: ${address.phone || '-'}`,
    address.line1 || 'Address not provided',
    address.line2,
    [address.city, address.state, address.pincode].filter(Boolean).join(', '),
    address.country || '-'
  ].filter(Boolean).map(text => ({ text }));
}

function renderWixStylePdf(model) {
  const commands = [];
  const text = createTextWriter(commands);
  const { order, payment, invoice, seller, buyer, billingAddress, shippingAddress, totals } = model;
  const paidAmount = amount(payment.paid_amount || totals.grandTotal);
  const balanceDue = Math.max(totals.grandTotal - paidAmount, 0);
  const currency = order.currency || 'INR';

  const logo = loadLogoImage();
  if (logo) {
    const width = fitImageWidth(logo, 110, 44);
    const height = fitImageHeight(logo, 110, 44);
    drawImage(commands, 'Logo', 42, 780 - height, width, height);
  } else {
    text(42, 790, 'HOLD MY THROTTLE', { size: 16, bold: true, color: '0.00 0.43 0.55 rg' });
  }

  text(42, 746, seller.name, { size: 12, bold: true });
  text(42, 728, seller.address, { size: 9 });
  text(42, 713, `Email: ${process.env.INVOICE_SELLER_EMAIL || 'store@bykr.co'}`, { size: 9 });
  text(42, 698, `Phone: ${process.env.INVOICE_SELLER_PHONE || '+91 8904137604'}`, { size: 9 });
  text(42, 683, `GSTIN: ${seller.gstin || 'Not configured'}`, { size: 9 });

  const metaRows = [
    ['Invoice No.:', invoice.number || '-'],
    ['Invoice Date:', invoice.date],
    ['Order No.:', order.order_number || order.external_order_id || '-'],
    invoice.awb ? ['AWB:', invoice.awb] : null
  ].filter(Boolean);
  const metaHeight = 34 + metaRows.length * 19;
  rect(commands, 360, 818 - metaHeight, 193, metaHeight, '1 1 1 rg');
  strokeRect(commands, 360, 818 - metaHeight, 193, metaHeight, '0.83 0.86 0.89 RG');
  let metaY = 792;
  for (const [label, value] of metaRows) {
    text(378, metaY, label, { size: 9, bold: true });
    text(450, metaY, value, { size: 9 });
    metaY -= 19;
  }

  line(commands, 42, 656, 553, 656, '0.82 0.84 0.86 RG');
  text(42, 632, 'Ship To:', { size: 11, bold: true });
  const shipAddressBottom = writeAddressBlock(text, 42, 614, shippingAddress, { email: order.email, gstin: '' });
  text(360, 632, 'Billing To:', { size: 11, bold: true });
  const billingAddressBottom = writeAddressBlock(text, 360, 614, billingAddress, {
    email: order.email,
    gstin: `Buyer Tax ID: ${buyer.gstin || '-'}${buyer.gstin && buyer.gstType ? ` (${buyer.gstType})` : ''}`
  });

  const tableTop = Math.min(510, Math.min(shipAddressBottom, billingAddressBottom) - 28);
  rect(commands, 42, tableTop, 511, 26, '0.38 0.38 0.38 rg');
  text(51, tableTop + 9, 'Name', { size: 8, bold: true, color: '1 1 1 rg' });
  text(218, tableTop + 9, 'SKU', { size: 8, bold: true, color: '1 1 1 rg' });
  text(280, tableTop + 9, 'HSN', { size: 8, bold: true, color: '1 1 1 rg' });
  text(335, tableTop + 9, 'Qty', { size: 8, bold: true, color: '1 1 1 rg' });
  text(369, tableTop + 9, 'Unit Price', { size: 8, bold: true, color: '1 1 1 rg' });
  text(444, tableTop + 9, 'Tax', { size: 8, bold: true, color: '1 1 1 rg' });
  text(511, tableTop + 9, 'Total', { size: 8, bold: true, color: '1 1 1 rg' });

  let y = tableTop - 24;
  model.items.forEach((item, itemIndex) => {
    const productLines = wrapText(item.name, 40).slice(0, 4);
    const skuLines = wrapText(item.sku || '-', 12).slice(0, 2);
    const rowHeight = Math.max(34, Math.max(productLines.length, skuLines.length) * 12 + 12);
    if (itemIndex % 2 === 1) rect(commands, 42, y - rowHeight + 17, 511, rowHeight, '0.96 0.97 0.98 rg');
    productLines.forEach((lineText, index) => text(51, y - index * 12, lineText, { size: 8 }));
    skuLines.forEach((lineText, index) => text(218, y - index * 12, lineText, { size: 8 }));
    text(280, y, item.hsn || '-', { size: 8 });
    text(340, y, String(item.quantity), { size: 8 });
    text(369, y, numberText(item.unitPrice), { size: 8 });
    text(444, y, numberText(item.taxAmount), { size: 8 });
    text(511, y, numberText(item.lineTotal), { size: 8 });
    line(commands, 42, y - rowHeight + 17, 553, y - rowHeight + 17, '0.88 0.90 0.92 RG');
    y -= rowHeight;
  });

  const totalsTop = y - 20;
  writeTotalRow(text, 358, 542, totalsTop, 'Merchandise Total:', money(totals.grossBeforeDiscount, currency));
  writeTotalRow(text, 358, 542, totalsTop - 18, 'Discount:', money(totals.discount, currency));
  writeTotalRow(text, 358, 542, totalsTop - 36, 'Shipping:', money(totals.shippingGross, currency));
  writeTotalRow(text, 358, 542, totalsTop - 54, 'Taxable Value:', money(totals.taxableValue, currency));
  writeTotalRow(text, 358, 542, totalsTop - 72, model.isIndia ? 'GST 18%:' : 'Tax 0%:', money(totals.taxAmount, currency));
  line(commands, 358, totalsTop - 87, 542, totalsTop - 87, '0.70 0.75 0.80 RG');
  writeTotalRow(text, 358, 542, totalsTop - 110, 'Grand Total:', money(totals.grandTotal, currency), { size: 11, bold: true });

  y = totalsTop - 140;
  text(42, y, 'Payment Summary', { size: 11, bold: true });
  y -= 18;
  text(42, y, `Amount Paid: ${money(paidAmount, currency)}`, { size: 9 });
  text(240, y, `Balance Due: ${money(balanceDue, currency)}`, { size: 9 });
  const paymentMeta = [
    payment.payment_method ? `Payment Method: ${payment.payment_method}` : '',
    invoice.paymentDate ? `Transaction Date: ${invoice.paymentDate}` : '',
    payment.transaction_ref ? `Transaction ID: ${payment.transaction_ref}` : ''
  ].filter(Boolean);
  if (paymentMeta.length) {
    y -= 16;
    paymentMeta.forEach((lineText, index) => text(42 + (index % 2) * 210, y - Math.floor(index / 2) * 14, lineText, { size: 8 }));
  }

  text(42, 70, 'Terms', { size: 10, bold: true });
  text(42, 53, 'By paying, you agree to all T&C mentioned on the website.', { size: 8 });

  const stream = commands.join('\n');
  const imageObjects = logo ? [createImageObject(logo)] : [];
  const imageResources = logo ? ' /XObject << /Logo 6 0 R >>' : '';
  const contentsRef = logo ? 7 : 6;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${imageResources} >> /Contents ${contentsRef} 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ...imageObjects,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  return writePdf(objects);
}

function renderInternationalLabelPdf(model) {
  // Thermal-label friendly: pure black ink, bold hierarchy, larger type, thick rules.
  // No blue/grey fills (they wash out or muddy on 203/300 dpi thermal heads).
  const commands = [];
  const text = createTextWriter(commands);
  const { order, invoice, seller, shippingAddress, totals } = model;
  const currency = order.currency || 'INR';
  const pageWidth = 283.465;
  const pageHeight = 425.197;
  const left = 10;
  const right = pageWidth - 10;
  const width = right - left;
  const black = '0 0 0 rg';
  const white = '1 1 1 rg';
  const rule = '0 0 0 RG';
  const shipperName = process.env.INVOICE_SHIPPER_NAME || process.env.INVOICE_SELLER_NAME || 'BYKR TECH PVT LTD';
  const shipperAddress = process.env.INVOICE_SHIPPER_ADDRESS || process.env.INVOICE_SELLER_ADDRESS ||
    '815 23rd Cross Road, 8A Main Road, 7th Sector, HSR Layout, Bengaluru, Karnataka 560102, India';
  const shipperPhone = formatInternationalPhone(
    process.env.INVOICE_SHIPPER_PHONE || process.env.INVOICE_SELLER_PHONE || '8904137604',
    'IN'
  );
  const shipperEmail = process.env.INVOICE_SHIPPER_EMAIL || process.env.INVOICE_SELLER_EMAIL || 'support@bykr.co';
  const iec = process.env.INVOICE_SELLER_IEC || 'AAOCB1362R';
  const lut = process.env.INVOICE_LUT_NUMBER || 'AD2906260133427';
  const terms = process.env.INVOICE_INCO_TERMS || 'CIF';
  const bankAdCode = process.env.INVOICE_BANK_AD_CODE || '00000006360108';
  const placeOfSupply = process.env.INVOICE_PLACE_OF_SUPPLY || 'India';
  const supplyDate = formatIsoDate(order.order_date || new Date().toISOString());
  const pieces = model.items.reduce((sum, item) => sum + item.quantity, 0) || order.quantity || 1;
  const destination = countryDisplayName(shippingAddress.country) || '-';
  const merchandiseTotal = roundMoney(totals.grossBeforeDiscount - totals.discount);
  const labelItems = consolidatedInternationalLabelItems(model, merchandiseTotal);
  const primaryItem = labelItems[0] || {};
  const recipientName = shippingAddress.name || order.customer_name || 'Not provided';
  const recipientPhone = formatInternationalPhone(
    shippingAddress.phone || order.phone,
    shippingAddress.country || order.country
  ) || '-';
  const recipientAddress = [
    shippingAddress.line1 || 'Address not provided',
    shippingAddress.line2,
    [shippingAddress.city, shippingAddress.state, shippingAddress.pincode, destination].filter(Boolean).join(', ')
  ].filter(Boolean).join(', ');

  strokeRect(commands, left, left, width, pageHeight - left * 2, rule, 1.6);

  let y = pageHeight - left;

  // Header: title left, reference stack right — high contrast, no pale fills.
  const headerH = 48;
  const splitX = left + 148;
  text(left + 7, y - 18, 'TAX INVOICE', { size: 13.5, bold: true });
  text(left + 7, y - 32, 'COMMERCIAL EXPORT', { size: 8, bold: true });
  thickLine(commands, splitX, y, splitX, y - headerH, 1.1);
  thickLine(commands, splitX, y - 16, right, y - 16, 0.9);
  thickLine(commands, splitX, y - 32, right, y - 32, 0.9);
  text(splitX + 6, y - 11.5, 'INVOICE', { size: 7, bold: true });
  writeAlignedCell(text, splitX + 52, y - 11.5, right - splitX - 58, invoice.number || '-', { size: 9, bold: true, align: 'right' });
  text(splitX + 6, y - 27.5, 'DATE', { size: 7, bold: true });
  writeAlignedCell(text, splitX + 40, y - 27.5, right - splitX - 46, supplyDate, { size: 8.5, bold: true, align: 'right' });
  text(splitX + 6, y - 43.5, 'AWB', { size: 7, bold: true });
  writeAlignedCell(text, splitX + 34, y - 43.5, right - splitX - 40, invoice.awb || 'Not assigned', { size: 8.5, bold: true, align: 'right' });
  y -= headerH;
  thickLine(commands, left, y, right, y, 1.4);

  const section = title => {
    // Solid black bar + white bold title: survives thermal dithering.
    rect(commands, left, y - 16, width, 16, black);
    text(left + 7, y - 11, title, { size: 8, bold: true, color: white });
    y -= 16;
  };

  // Consignee — full-width rows (not tiny side label columns that print faint).
  section('CONSIGNEE / SHIP TO');
  text(left + 7, y - 11, recipientName, { size: 10.5, bold: true });
  const shownAddress = wrapText(recipientAddress, 50).slice(0, 2);
  shownAddress.forEach((value, index) => {
    text(left + 7, y - 23 - index * 10.5, value, { size: 8.5 });
  });
  const addressH = 13 + shownAddress.length * 10.5;
  text(left + 7, y - addressH - 11, `Phone  ${recipientPhone}`, { size: 9, bold: true });
  y -= addressH + 16;
  thickLine(commands, left, y, right, y, 1.2);

  // Items — full-width description, meta underneath (avoids cramped columns).
  section('ITEMS');
  const itemName = primaryItem.name || order.product_variant || 'Product';
  const itemLines = wrapText(itemName, 46).slice(0, 2);
  itemLines.forEach((value, index) => text(left + 7, y - 11 - index * 10.5, value, { size: 9.5, bold: true }));
  const itemNameH = Math.max(12, itemLines.length * 10.5 + 1);
  text(left + 7, y - itemNameH - 9, `HSN ${primaryItem.hsn || '-'}  |  Qty ${primaryItem.quantity || 1}  |  IGST 0%`, { size: 8.5 });
  text(left + 7, y - itemNameH - 20, `Unit price  ${currency} ${numberText(primaryItem.unitPrice || 0)}`, { size: 8.5 });
  writeAlignedCell(
    text,
    left + 7,
    y - itemNameH - 20,
    width - 14,
    `Amount  ${currency} ${numberText(primaryItem.lineTotal || merchandiseTotal)}`,
    { size: 9.5, bold: true, align: 'right' }
  );
  y -= itemNameH + 26;
  thickLine(commands, left, y, right, y, 1.2);

  // Totals — declared value emphasized for customs glance.
  section('TOTAL TO DECLARE');
  const totalRows = [
    ['Product amount', `${currency} ${numberText(merchandiseTotal)}`, false],
    ['Shipping', `${currency} ${numberText(totals.shippingGross)}`, false],
    ['IGST', `${currency} 0.00`, false],
    ['TOTAL AFTER TAX', `${currency} ${numberText(totals.grandTotal)}`, true]
  ];
  totalRows.forEach(([label, value, emphasize]) => {
    const rowH = emphasize ? 16 : 12.5;
    const rowTop = y;
    if (emphasize) {
      // Black bar for the grand total so it stands out after print.
      rect(commands, left, rowTop - rowH, width, rowH, black);
      text(left + 7, rowTop - 11, label, { size: 9, bold: true, color: white });
      writeAlignedCell(text, left + 7, rowTop - 11, width - 14, value, { size: 10.5, bold: true, align: 'right', color: white });
    } else {
      text(left + 7, rowTop - 9, label, { size: 8.5 });
      writeAlignedCell(text, left + 7, rowTop - 9, width - 14, value, { size: 9, bold: true, align: 'right' });
      thickLine(commands, left, rowTop - rowH, right, rowTop - rowH, 0.7);
    }
    y -= rowH;
  });
  thickLine(commands, left, y, right, y, 1.2);

  // Exporter & export details — two-column key values, larger digits.
  section('EXPORTER & EXPORT DETAILS');
  text(left + 7, y - 10, shipperName, { size: 9, bold: true });
  const exporterAddressLines = wrapText(shipperAddress, 52).slice(0, 2);
  exporterAddressLines.forEach((value, index) => text(left + 7, y - 20.5 - index * 9, value, { size: 7.8 }));
  text(left + 7, y - 40, `Tel: ${shipperPhone}  |  ${shipperEmail}`, { size: 7.8 });
  y -= 45;
  thickLine(commands, left, y, right, y, 0.9);

  const half = width / 2;
  const detailPairs = [
    ['GSTIN', seller.gstin || '-'],
    ['IEC / PAN', iec],
    ['LUT NO.', lut],
    ['BANK AD CODE', bankAdCode]
  ];
  // 2x2 grid of customs IDs.
  detailPairs.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = left + 7 + col * half;
    const rowY = y - 10 - row * 22;
    text(x, rowY, label, { size: 7, bold: true });
    text(x, rowY - 10, value, { size: 8.8, bold: true });
  });
  y -= 46;
  thickLine(commands, left + half, y + 46, left + half, y, 0.8);
  thickLine(commands, left, y + 23, right, y + 23, 0.7);
  thickLine(commands, left, y, right, y, 0.9);

  text(left + 7, y - 11, `Destination ${destination}  |  Incoterm ${terms}  |  Place of supply ${placeOfSupply}  |  Pieces ${pieces}`, { size: 7.2 });
  text(left + 7, y - 21, 'Supply meant for export under LUT without payment of IGST.', { size: 7.2 });
  text(left + 7, y - 31, 'Original for recipient / customs', { size: 7.2, bold: true });

  strokeRect(commands, left, left, width, pageHeight - left * 2, rule, 1.6);

  const stream = commands.join('\n');
  return writePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]);
}

function thickLine(commands, x1, y1, x2, y2, width = 1.2) {
  commands.push('q');
  commands.push('0 0 0 RG');
  commands.push(`${width} w`);
  commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  commands.push('Q');
}

function consolidatedInternationalLabelItems(model, merchandiseTotal) {
  const rankedItems = [...(model.items || [])].sort((leftItem, rightItem) =>
    internationalInvoiceItemValue(rightItem) - internationalInvoiceItemValue(leftItem)
  );
  const primaryItems = rankedItems.filter(item => !isInternationalInvoiceAccessory(item));
  const primary = primaryItems[0] || rankedItems[0] || {};
  const quantity = Number(primary.quantity || model.order.quantity || 1) || 1;
  return [{
    ...primary,
    name: primary.name || model.order.product_variant || 'Hold My Throttle Kit',
    hsn: primary.hsn || '',
    quantity,
    unitPrice: roundMoney(merchandiseTotal / quantity),
    lineTotal: merchandiseTotal,
    taxAmount: 0
  }];
}

function isInternationalInvoiceAccessory(item = {}) {
  const name = String(item.name || '');
  return /\bmirror\b.*\bmounts?\b|\baccessor(?:y|ies)\b/i.test(name);
}

function internationalInvoiceItemValue(item = {}) {
  const lineTotal = Number(item.lineTotal);
  if (Number.isFinite(lineTotal) && lineTotal > 0) return lineTotal;
  const gross = Number(item.grossBeforeDiscount);
  if (Number.isFinite(gross) && gross > 0) return gross;
  return Number(item.unitPrice || 0) * (Number(item.quantity || 1) || 1);
}

function createTextWriter(commands) {
  return function text(x, y, value, options = {}) {
    if (value === undefined || value === null || value === '') return;
    const size = options.size || 10;
    const font = options.bold ? 'F2' : 'F1';
    commands.push('BT');
    commands.push(options.color || '0 0 0 rg');
    commands.push(`/${font} ${size} Tf`);
    commands.push(`1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj`);
    commands.push('ET');
  };
}

function writeWrappedText(text, x, y, value, limit, options = {}) {
  const lines = wrapText(value, limit).slice(0, options.maxLines || Infinity);
  lines.forEach((lineText, index) => text(x, y - index * (options.lineHeight || 10), lineText, options));
  return y - lines.length * (options.lineHeight || 10);
}

function writeAlignedCell(text, x, y, width, value, options = {}) {
  if (value === undefined || value === null || value === '') return;
  const size = options.size || 10;
  const bold = Boolean(options.bold);
  const estimatedWidth = estimatedTextWidth(value, size, bold);
  let drawX = x;
  if (options.align === 'center') {
    drawX = x + Math.max((width - estimatedWidth) / 2, 0);
  } else if (options.align === 'right') {
    drawX = x + Math.max(width - estimatedWidth - 1, 0);
  }
  text(drawX, y, value, options);
}

function writeAddress(text, x, y, address) {
  const lines = addressLines(address).map(line => line.text);
  lines.slice(0, 6).forEach((line, index) => text(x, y - index * 13, line, { size: 8 }));
}

function writeAddressBlock(text, x, y, address, extras = {}) {
  const lines = [
    address.name || 'Not provided',
    address.line1 || 'Address not provided',
    address.line2,
    [address.city, address.state, address.pincode].filter(Boolean).join(', '),
    address.country || '-',
    extras.email ? `Email: ${extras.email}` : '',
    address.phone ? `Tel: ${address.phone}` : '',
    extras.gstin || ''
  ].filter(Boolean);
  let cursor = y;
  for (const lineText of lines) {
    const wrapped = wrapText(lineText, 43).slice(0, 2);
    wrapped.forEach(part => {
      text(x, cursor, part, { size: 8 });
      cursor -= 13;
    });
  }
  return cursor;
}

function line(commands, x1, y1, x2, y2, color = '0.80 0.83 0.86 RG') {
  commands.push('q');
  commands.push(color);
  commands.push('0.8 w');
  commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  commands.push('Q');
}

function rect(commands, x, y, width, height, fillColor) {
  commands.push('q');
  commands.push(fillColor);
  commands.push(`${x} ${y} ${width} ${height} re f`);
  commands.push('Q');
}

function strokeRect(commands, x, y, width, height, strokeColor = '0.80 0.83 0.86 RG', lineWidth = 0.8) {
  commands.push('q');
  commands.push(strokeColor);
  commands.push(`${lineWidth} w`);
  commands.push(`${x} ${y} ${width} ${height} re S`);
  commands.push('Q');
}

function writeTotalRow(text, labelX, amountRightX, y, label, value, options = {}) {
  const size = options.size || 9;
  text(labelX, y, label, { size, bold: options.bold });
  text(amountRightX - estimatedTextWidth(value, size, options.bold), y, value, { size, bold: options.bold });
}

function estimatedTextWidth(value, size, bold = false) {
  const averageGlyphWidth = bold ? 0.58 : 0.52;
  return String(value || '').length * size * averageGlyphWidth;
}

function drawImage(commands, name, x, y, width, height) {
  commands.push('q');
  commands.push(`${width} 0 0 ${height} ${x} ${y} cm`);
  commands.push(`/${name} Do`);
  commands.push('Q');
}

function fitImageWidth(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return roundMoney(image.width * scale);
}

function fitImageHeight(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return roundMoney(image.height * scale);
}

function loadLogoImage() {
  const logoPath = join(process.cwd(), 'public', 'hold-my-throttle-logo.png');
  if (!existsSync(logoPath)) return null;
  try {
    return decodePng(readFileSync(logoPath));
  } catch {
    return null;
  }
}

function createImageObject(image) {
  const compressed = deflateSync(image.rgb);
  return Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'),
    compressed,
    Buffer.from('\nendstream', 'latin1')
  ]);
}

function decodePng(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('Invalid PNG signature.');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) throw new Error('Unsupported PNG format.');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  if (!width || !height || !idat.length) throw new Error('Missing PNG image data.');
  const bytesPerPixel = pngBytesPerPixel(colorType);
  const scanlineLength = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const raw = Buffer.alloc(height * scanlineLength);
  let sourceOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[sourceOffset];
    sourceOffset += 1;
    for (let col = 0; col < scanlineLength; col += 1) {
      const value = inflated[sourceOffset + col];
      const left = col >= bytesPerPixel ? raw[row * scanlineLength + col - bytesPerPixel] : 0;
      const up = row > 0 ? raw[(row - 1) * scanlineLength + col] : 0;
      const upLeft = row > 0 && col >= bytesPerPixel ? raw[(row - 1) * scanlineLength + col - bytesPerPixel] : 0;
      raw[row * scanlineLength + col] = unfilterPngByte(filterType, value, left, up, upLeft);
    }
    sourceOffset += scanlineLength;
  }
  return {
    width,
    height,
    rgb: pngToRgb(raw, width, height, colorType, bytesPerPixel)
  };
}

function pngBytesPerPixel(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 6) return 4;
  throw new Error('Unsupported PNG color type.');
}

function unfilterPngByte(filterType, value, left, up, upLeft) {
  if (filterType === 0) return value;
  if (filterType === 1) return (value + left) & 0xff;
  if (filterType === 2) return (value + up) & 0xff;
  if (filterType === 3) return (value + Math.floor((left + up) / 2)) & 0xff;
  if (filterType === 4) return (value + paethPredictor(left, up, upLeft)) & 0xff;
  throw new Error('Unsupported PNG filter.');
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function pngToRgb(raw, width, height, colorType, bytesPerPixel) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * bytesPerPixel;
    const target = pixel * 3;
    if (colorType === 0) {
      rgb[target] = raw[source];
      rgb[target + 1] = raw[source];
      rgb[target + 2] = raw[source];
    } else if (colorType === 2) {
      rgb[target] = raw[source];
      rgb[target + 1] = raw[source + 1];
      rgb[target + 2] = raw[source + 2];
    } else {
      const alpha = raw[source + 3] / 255;
      rgb[target] = Math.round(raw[source] * alpha + 255 * (1 - alpha));
      rgb[target + 1] = Math.round(raw[source + 1] * alpha + 255 * (1 - alpha));
      rgb[target + 2] = Math.round(raw[source + 2] * alpha + 255 * (1 - alpha));
    }
  }
  return rgb;
}

function writePdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(bufferLength(chunks));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, 'latin1'));
    chunks.push(Buffer.isBuffer(object) ? object : Buffer.from(object, 'latin1'));
    chunks.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  const xrefOffset = bufferLength(chunks);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, 'latin1'));
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(Buffer.from(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`, 'latin1'));
  }
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function bufferLength(chunks) {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

function pdfText(value) {
  return String(value)
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrap(value, limit) {
  if (!value) return [''];
  const words = value.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (`${current} ${word}`.trim().length > limit) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapText(value, limit) {
  return wrap(String(value || '').replace(/\s+/g, ' '), limit);
}

function fit(value, length) {
  const text = String(value || '').replace(/\s+/g, ' ');
  return text.length > length ? `${text.slice(0, length - 3)}...` : text.padEnd(length, ' ');
}

function pad(value, length) {
  return String(value ?? '').padStart(length, ' ');
}

function money(value, currency = 'INR') {
  return `${currency || 'INR'} ${Number(value || 0).toFixed(2)}`;
}

function numberText(value) {
  return Number(value || 0).toFixed(2);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function countryDisplayName(country) {
  const code = String(country || '').trim().toUpperCase();
  if (!code) return '';
  if (code === 'IN') return 'India';
  if (code === 'BR') return 'Brazil';
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(code) || code;
  } catch {
    return code;
  }
}

function formatInternationalPhone(phone, country) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return `+${raw.slice(1).replace(/\D/g, '')}`;
  if (raw.startsWith('00')) return `+${raw.slice(2).replace(/\D/g, '')}`;

  const digits = raw.replace(/\D/g, '');
  const countryCode = internationalCallingCode(country);
  if (!digits || !countryCode) return raw;
  if (digits.startsWith(countryCode) && digits.length > countryCode.length + 6) {
    return `+${digits}`;
  }
  return `+${countryCode}${digits.replace(/^0+/, '')}`;
}

function internationalCallingCode(country) {
  const normalized = String(country || '').trim().toUpperCase();
  const aliases = {
    INDIA: 'IN', AUSTRALIA: 'AU', 'UNITED STATES': 'US', USA: 'US',
    'UNITED KINGDOM': 'GB', UK: 'GB', CANADA: 'CA', BRAZIL: 'BR',
    GERMANY: 'DE', FRANCE: 'FR', ITALY: 'IT', SPAIN: 'ES',
    NETHERLANDS: 'NL', SINGAPORE: 'SG', JAPAN: 'JP',
    'UNITED ARAB EMIRATES': 'AE', UAE: 'AE', 'NEW ZEALAND': 'NZ'
  };
  const code = aliases[normalized] || normalized;
  return {
    AE: '971', AR: '54', AT: '43', AU: '61', BE: '32', BG: '359',
    BR: '55', CA: '1', CH: '41', CL: '56', CN: '86', CO: '57',
    CZ: '420', DE: '49', DK: '45', EE: '372', ES: '34', FI: '358',
    FR: '33', GB: '44', GR: '30', HK: '852', HR: '385', HU: '36',
    ID: '62', IE: '353', IL: '972', IN: '91', IS: '354', IT: '39',
    JP: '81', KR: '82', LT: '370', LU: '352', LV: '371', MX: '52',
    MY: '60', NL: '31', NO: '47', NZ: '64', PE: '51', PH: '63',
    PL: '48', PT: '351', RO: '40', RU: '7', SA: '966', SE: '46',
    SG: '65', SI: '386', SK: '421', TH: '66', TR: '90', TW: '886',
    UA: '380', US: '1', VN: '84', ZA: '27'
  }[code] || '';
}

function isExportUsingEcommerce(order = {}) {
  const candidates = [
    order.export_using_ecommerce,
    order.exportUsingEcommerce,
    order.is_ecommerce,
    order.isEcommerce,
    order.ecommerce,
    order.channel_type
  ];
  for (const value of candidates) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['yes', 'y', 'true', '1', 'ecommerce', 'e-commerce', 'ecom'].includes(normalized)) return true;
      if (['no', 'n', 'false', '0'].includes(normalized)) return false;
    }
  }
  return true;
}

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitInclusiveTax(gross, rate = 0.18) {
  const taxableValue = roundMoney(amount(gross) / (1 + rate));
  return {
    taxableValue,
    taxAmount: roundMoney(amount(gross) - taxableValue)
  };
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isIndiaCountry(country) {
  return ['IN', 'IND', 'INDIA'].includes(String(country || '').trim().toUpperCase());
}

function latestShipmentWaybill(shipments = []) {
  return [...(shipments || [])]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .find(shipment => shipment?.waybill)?.waybill || '';
}

function paymentDate(payment = {}) {
  const activities = payment.raw_payment?.activities || [];
  const paidActivity = activities.find(activity => /paid|payment|capture|sale/i.test(String(activity.type || activity.activityType || activity.name || '')));
  const value =
    paidActivity?.createdDate ||
    paidActivity?.createdAt ||
    paidActivity?.date ||
    payment.raw_payment?.paidDate ||
    payment.raw_payment?.paymentDate;
  return value ? formatDate(value) : '';
}
