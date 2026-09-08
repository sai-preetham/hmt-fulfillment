'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function FulfillShipmentButton({ orderId, shipment }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  if (!orderId || !shipment.waybill || shipment.direction === 'reverse' || ['cancelled', 'canceled', 'returned', 'rto', 'failed', 'pending', 'pending-zone', 'pending-international'].includes(String(shipment.status).toLowerCase())) return null;

  async function fulfill() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/crm/orders/${orderId}/wix/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'fulfilled', shipmentId: shipment.id })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Wix fulfillment failed.');
      setDone(true);
      router.refresh();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return <div><button type="button" className="button secondary" onClick={fulfill} disabled={busy || done} title="Use after the courier has picked up this shipment. Sends tracking and marks the order fulfilled on Wix.">{busy ? 'Fulfilling…' : done ? 'Fulfilled on Wix' : 'Mark fulfilled on Wix'}</button>{error ? <small className="dangerText" role="alert">{error}</small> : null}</div>;
}
