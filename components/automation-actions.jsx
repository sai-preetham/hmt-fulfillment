'use client';

import { useState } from 'react';

export function AutomationActions({ batches = [] }) {
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function runNow() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/automation/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`
        },
        body: JSON.stringify({ trigger: 'dashboard', force: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Automation run failed.');
      setMessage(`Run ${data.status}: ${data.counters?.processed || 0} processed, ${data.counters?.booked || 0} booked, ${data.counters?.fedexQueued || 0} FedEx queued.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadBatch(batchId, batchNumber) {
    setMessage('');
    try {
      const response = await fetch(`/api/automation/fedex/export?batchId=${encodeURIComponent(batchId)}`, {
        headers: { Authorization: `Bearer ${secret}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'FedEx CSV export failed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${batchNumber || 'fedex-export'}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('FedEx CSV downloaded.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Controls</h2>
      </div>
      <div className="panelBody grid">
        <label className="full">
          <span>Automation secret</span>
          <input
            type="password"
            value={secret}
            onChange={event => setSecret(event.target.value)}
            placeholder="AUTOMATION_SECRET"
          />
        </label>
        <div className="toolbar">
          <button type="button" onClick={runNow} disabled={busy}>{busy ? 'Running...' : 'Run automation now'}</button>
          {message ? <span className="muted">{message}</span> : null}
        </div>
        {batches.length ? (
          <div className="grid">
            {batches.map(batch => (
              <div className="taskCard" key={batch.id}>
                <strong>{batch.batch_number}</strong>
                <span className="subtle">{batch.status} · {(batch.fedex_export_items || []).length} orders</span>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <button type="button" className="secondary" onClick={() => downloadBatch(batch.id, batch.batch_number)}>Download CSV</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
