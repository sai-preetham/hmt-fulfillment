'use client';

import { useState } from 'react';

export function PrintLabelButton({ shipmentId, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function print() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/crm/shipments/${shipmentId}/print`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      setMessage(result.message || result.error || (response.ok ? 'Print job queued.' : 'Print job failed.'));
    } catch {
      setMessage('Could not contact the print service.');
    } finally {
      setBusy(false);
    }
  }

  return <span className="shipmentActions"><button type="button" className="button secondary" onClick={print} disabled={busy || disabled}>{busy ? 'Printing…' : 'Print 10×15'}</button>{message ? <small className={message.includes('Queued') ? 'muted' : 'dangerText'}>{message}</small> : null}</span>;
}
