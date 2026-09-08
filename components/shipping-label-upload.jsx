'use client';

import { useRef, useState } from 'react';

export function ShippingLabelUpload({ orderId, shipments = [] }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [shipmentId, setShipmentId] = useState(shipments[0]?.id || '');

  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage('');
    const body = new FormData();
    body.set('shipping_label', file);
    if (shipmentId) body.set('shipment_id', shipmentId);
    try {
      const response = await fetch(`/api/crm/orders/${orderId}/shipping-label`, { method: 'POST', body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || 'Shipping-label upload failed.');
        return;
      }
      setMessage('Label saved.');
      window.location.reload();
    } catch {
      setMessage('Shipping-label upload failed. Please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <span className="shippingLabelUpload">
      {shipments.length > 1 ? (
        <select aria-label="Shipment for label" value={shipmentId} onChange={event => setShipmentId(event.target.value)} disabled={busy}>
          {shipments.map(shipment => (
            <option value={shipment.id} key={shipment.id}>
              {[shipment.courier_code || shipment.courier || 'Courier', shipment.waybill || shipment.awb_number || 'No AWB'].join(' · ')}
            </option>
          ))}
        </select>
      ) : null}
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={upload} disabled={busy} hidden />
      <button type="button" className="button secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? 'Uploading label…' : 'Upload shipping label'}
      </button>
      {message ? <small className="muted">{message}</small> : null}
    </span>
  );
}
