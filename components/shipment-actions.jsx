'use client';

import { useState } from 'react';
import { PrintLabelButton } from './print-label-button';
import { defaultPickupWindow } from './pickup-location-groups';

export function ShipmentActions({ orderId, shipment }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const status = String(shipment.status || '').toLowerCase();
  const canCancel = shipment.waybill && String(shipment.courier_code || '').toLowerCase() === 'delhivery' && !['delivered', 'cancelled', 'returned', 'rto'].includes(status);
  const canPrint = Boolean(shipment.id && shipment.waybill && String(shipment.courier_code || 'delhivery').toLowerCase() === 'delhivery');
  const canRaisePickup = canPrint && shipment.direction !== 'reverse' && !['pickup_pending', 'picked-up', 'picked_up', 'dispatched', 'in-transit', 'in_transit', 'out-for-delivery', 'out_for_delivery', 'delivered', 'cancelled', 'canceled', 'returned', 'rto'].includes(status);
  if (!canCancel && !canPrint && !canRaisePickup) return null;

  async function cancel() {
    if (!window.confirm(`Cancel Delhivery shipment ${shipment.waybill}? This cannot be undone.`)) return;
    setBusy(true);
    setMessage('');
    const response = await fetch(`/api/crm/orders/${orderId}/shipments/${shipment.id}/cancel`, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(result.message || result.error || 'Cancellation request finished.');
    if (result.ok) window.location.reload();
  }

  async function raisePickup() {
    const defaults = defaultPickupWindow();
    setBusy(true);
    setMessage('');
    const response = await fetch(`/api/crm/orders/${orderId}/shipments/${shipment.id}/pickup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickup_date: defaults.date, pickup_time: defaults.time, pickup_location: shipment.pickup_location, expected_package_count: 1 })
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(result.message || result.error || 'Pickup request finished.');
    if (result.ok) window.location.reload();
  }

  return <div className="shipmentActions">{canPrint ? <PrintLabelButton shipmentId={shipment.id} /> : null}{canRaisePickup ? <button type="button" className="button secondary" onClick={raisePickup} disabled={busy}>{busy ? 'Raising…' : 'Raise pickup'}</button> : null}{canCancel ? <button type="button" className="button danger" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel'}</button> : null}{message ? <small className="dangerText">{message}</small> : null}</div>;
}
