const statusKey = shipment => String(shipment.status_key || shipment.status || '').trim().toLowerCase().replaceAll('_', '-');
const waiting = new Set(['booked', 'shipment-booked', 'pickup-pending', 'manifested', 'ready-to-ship', 'pickup-error']);
const collected = new Set(['picked-up', 'dispatched', 'in-transit', 'out-for-delivery', 'delivered']);

export function isAwaitingWarehousePickup(shipment = {}) {
  return shipment.direction !== 'reverse' && Boolean(String(shipment.waybill || '').trim()) && waiting.has(statusKey(shipment));
}

export function canConfirmPickup(shipment = {}) {
  return isAwaitingWarehousePickup(shipment) || (
    shipment.direction !== 'reverse' && Boolean(String(shipment.waybill || '').trim()) && collected.has(statusKey(shipment))
  );
}

export function hasCompletedPickup(shipment = {}) {
  const key = statusKey(shipment);
  const fulfillment = String(shipment.fulfillment_status || '').trim().toUpperCase();
  const wixStatus = String(shipment.wix_fulfillment_status || '').trim().toLowerCase();
  return collected.has(key) || fulfillment === 'FULFILLED' || wixStatus === 'fulfilled' || wixStatus === 'synced';
}
