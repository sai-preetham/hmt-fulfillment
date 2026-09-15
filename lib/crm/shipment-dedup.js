export function normalizeAwb(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

export function isDuplicateShipmentError(error) {
  return error?.code === '23505' || /duplicate key|unique constraint/i.test(error?.message || '');
}

export function findMatchingShipment(rows, { orderId, waybill }) {
  const normalizedAwb = normalizeAwb(waybill);
  return (rows || []).find(row =>
    row.order_id === orderId &&
    normalizeAwb(row.waybill) === normalizedAwb
  ) || null;
}
