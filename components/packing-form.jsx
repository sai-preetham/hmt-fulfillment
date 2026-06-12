'use client';

import { useState } from 'react';
import { PACKING_ITEMS } from '@/lib/crm/constants';

export function PackingForm({ order, checklist = [] }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const packed = new Set(checklist.filter(item => item.is_packed).map(item => item.item_name));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch(`/api/crm/orders/${order.id}/packing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    setBusy(false);
    setMessage(response.ok ? (data.demo ? 'Checklist validated in demo mode.' : 'Packing checklist saved.') : data.error || 'Packing update failed.');
  }

  return (
    <form onSubmit={submit} className="grid">
      <div className="checklist">
        {PACKING_ITEMS.map(item => (
          <label className="checkItem" key={item}>
            <input type="checkbox" name={`item:${item}`} defaultChecked={packed.has(item)} />
            <span>{item}</span>
          </label>
        ))}
      </div>
      <div className="formGrid">
        <label>
          <span>Package weight (grams)</span>
          <input type="number" name="package_weight_grams" defaultValue="500" />
        </label>
        <label>
          <span>Length (cm)</span>
          <input type="number" name="package_length_cm" defaultValue="24" />
        </label>
        <label>
          <span>Width (cm)</span>
          <input type="number" name="package_width_cm" defaultValue="18" />
        </label>
        <label>
          <span>Height (cm)</span>
          <input type="number" name="package_height_cm" defaultValue="8" />
        </label>
        <label className="full">
          <span>Packing photo URL</span>
          <input name="packing_photo_url" placeholder="Upload to Supabase Storage and paste URL" />
        </label>
      </div>
      <div className="toolbar">
        <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Mark packing progress'}</button>
        <button type="button" className="secondary">Ready for pickup</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}
