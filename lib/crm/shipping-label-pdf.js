import { deflateSync, inflateSync } from 'node:zlib';

export function shippingLabelFilename(shipment = {}) {
  const waybill = String(shipment.waybill || shipment.wbn || 'label').replace(/[^a-z0-9_-]+/gi, '-');
  return `delhivery-label-${waybill}.pdf`;
}

export function buildDelhiveryShippingLabelPdf(payload = {}) {
  const pkg = Array.isArray(payload.packages) ? payload.packages[0] || {} : payload;
  const commands = [];
  const text = createTextWriter(commands);
  const barcode = decodeDataImage(pkg.barcode);

  strokeRect(commands, 16, 16, 256, 400, '0 0 0 RG', 1.2);
  rect(commands, 16, 378, 256, 38, '0.94 0.95 0.96 rg');
  text(28, 398, 'DELHIVERY', { size: 16, bold: true });
  text(182, 401, String(pkg.pt || pkg.payment_mode || 'Pre-paid').toUpperCase(), { size: 9, bold: true });
  text(182, 386, `Mode: ${pkg.mot || '-'}`, { size: 8 });

  text(28, 356, `AWB: ${pkg.wbn || '-'}`, { size: 16, bold: true });
  text(28, 338, `Order: ${pkg.oid || '-'}`, { size: 10, bold: true });

  if (barcode) {
    drawImage(commands, 'Barcode', 42, 254, 204, 72);
    text(centerX(String(pkg.wbn || ''), 10, 144), 240, pkg.wbn || '', { size: 10, bold: true });
  }

  line(commands, 16, 226, 272, 226, '0.65 0.65 0.65 RG');
  text(28, 208, 'SHIP TO', { size: 9, bold: true });
  let y = 193;
  for (const lineText of addressLines(pkg).slice(0, 7)) {
    for (const part of wrapText(lineText, 42).slice(0, 2)) {
      text(28, y, part, { size: 8.5, bold: y === 193 });
      y -= 11;
    }
  }

  const metaTop = 96;
  line(commands, 16, metaTop + 16, 272, metaTop + 16, '0.65 0.65 0.65 RG');
  twoCol(text, 28, metaTop, 'Origin', pkg.origin_city || pkg.origin || '-');
  twoCol(text, 28, metaTop - 15, 'Destination', pkg.destination_city || pkg.destination || '-');
  twoCol(text, 28, metaTop - 30, 'Sort code', pkg.sort_code || '-');
  twoCol(text, 28, metaTop - 45, 'Weight', pkg.weight ? `${pkg.weight} g` : '-');
  twoCol(text, 156, metaTop, 'COD', money(pkg.cod || 0));
  twoCol(text, 156, metaTop - 15, 'Value', money(pkg.rs || 0));
  twoCol(text, 156, metaTop - 30, 'Qty', pkg.qty || '-');
  twoCol(text, 156, metaTop - 45, 'HSN', pkg.hsn_code || '-');

  const product = wrapText(pkg.prd || pkg.products_desc || '', 48).slice(0, 2);
  product.forEach((part, index) => text(28, 30 - index * 10, part, { size: 7 }));

  const stream = commands.join('\n');
  const imageObjects = barcode ? [createImageObject(barcode)] : [];
  const imageResources = barcode ? ' /XObject << /Barcode 6 0 R >>' : '';
  const contentsRef = barcode ? 7 : 6;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${imageResources} >> /Contents ${contentsRef} 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ...imageObjects,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  return writePdf(objects);
}

function addressLines(pkg) {
  return [
    pkg.name || 'Customer',
    pkg.address || '',
    [pkg.destination_city, pkg.st || pkg.customer_state, pkg.pin].filter(Boolean).join(', '),
    pkg.contact || pkg.cnph ? `Phone: ${pkg.contact || pkg.cnph}` : ''
  ].filter(Boolean);
}

function twoCol(text, x, y, label, value) {
  text(x, y, `${label}:`, { size: 7, bold: true });
  text(x + 46, y, String(value || '-'), { size: 7 });
}

function money(value) {
  const number = Number(value || 0);
  return number ? `INR ${number.toFixed(0)}` : 'INR 0';
}

function createTextWriter(commands) {
  return function text(x, y, value, options = {}) {
    if (value === undefined || value === null || value === '') return;
    const size = options.size || 10;
    commands.push('BT');
    commands.push(options.color || '0 0 0 rg');
    commands.push(`/${options.bold ? 'F2' : 'F1'} ${size} Tf`);
    commands.push(`1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj`);
    commands.push('ET');
  };
}

function rect(commands, x, y, width, height, fillColor) {
  commands.push('q');
  commands.push(fillColor);
  commands.push(`${x} ${y} ${width} ${height} re f`);
  commands.push('Q');
}

function strokeRect(commands, x, y, width, height, strokeColor = '0 0 0 RG', strokeWidth = 0.8) {
  commands.push('q');
  commands.push(strokeColor);
  commands.push(`${strokeWidth} w`);
  commands.push(`${x} ${y} ${width} ${height} re S`);
  commands.push('Q');
}

function line(commands, x1, y1, x2, y2, color = '0 0 0 RG') {
  commands.push('q');
  commands.push(color);
  commands.push('0.8 w');
  commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  commands.push('Q');
}

function drawImage(commands, name, x, y, width, height) {
  commands.push('q');
  commands.push(`${width} 0 0 ${height} ${x} ${y} cm`);
  commands.push(`/${name} Do`);
  commands.push('Q');
}

function createImageObject(image) {
  const compressed = deflateSync(image.rgb);
  return Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'),
    compressed,
    Buffer.from('\nendstream', 'latin1')
  ]);
}

function decodeDataImage(value) {
  const match = String(value || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  try {
    return decodePng(Buffer.from(match[1], 'base64'));
  } catch {
    return null;
  }
}

function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG signature.');
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
      if (bitDepth !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('Unsupported PNG format.');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
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
  return { width, height, rgb: pngToRgb(raw, width, height, colorType, bytesPerPixel) };
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
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, 'latin1'));
    chunks.push(Buffer.isBuffer(object) ? object : Buffer.from(object, 'latin1'));
    chunks.push(Buffer.from('\nendobj\n', 'latin1'));
  });
  const xrefOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, 'latin1'));
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(Buffer.from(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`, 'latin1'));
  }
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function centerX(value, size, pageCenter) {
  return Math.max(24, pageCenter - String(value || '').length * size * 0.26);
}

function pdfText(value) {
  return String(value)
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(value, limit) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
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
  return lines.length ? lines : [''];
}
