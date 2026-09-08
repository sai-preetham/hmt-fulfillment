export function validateShipmentPayload(payload, { manualAwb = false } = {}) {
  const missing = [];
  if (manualAwb) {
    if (!String(payload.awb_number || '').trim()) missing.push('AWB is required to save a manual shipment');
    return missing;
  }
  if (!payload.phone) missing.push('Missing phone number');
  if (isIndiaCountry(payload.country) && !/^[1-9][0-9]{5}$/.test(String(payload.pincode || ''))) missing.push('Invalid pincode');
  if (!payload.address_line1) missing.push('Missing address line');
  if (!Number(payload.product_value)) missing.push('Missing product value');
  if (!Number(payload.weight_grams)) missing.push('Missing weight');
  if (!Number(payload.length_cm) || !Number(payload.width_cm) || !Number(payload.height_cm)) missing.push('Missing dimensions');
  return missing;
}

function isIndiaCountry(country) {
  const normalized = String(country || 'IN').trim().toUpperCase();
  return normalized === 'IN' || normalized === 'INDIA';
}
