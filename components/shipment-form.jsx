'use client';

import { useState } from 'react';
import { BOOKING_COURIERS, COURIERS } from '@/lib/crm/constants';

export function ShipmentForm({ order }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const [courier, setCourier] = useState(order.courier || 'delhivery');
  const [labelUrl, setLabelUrl] = useState(order.label_url || '');
  const [awbNumber, setAwbNumber] = useState(order.awb_number || '');
  const selectedBookingCourier = BOOKING_COURIERS.find(item => item.code === courier);
  const services = selectedBookingCourier?.services || [];
  const canGenerateLabel = Boolean(labelUrl || awbNumber);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const submitter = event.nativeEvent.submitter;
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    if (submitter?.name) body[submitter.name] = submitter.value;
    const response = await fetch(`/api/crm/orders/${order.id}/shipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage((data.validation || [data.error || 'Shipment booking failed']).join(', '));
      return;
    }
    if (data.label_url) setLabelUrl(data.label_url);
    if (data.awb_number) setAwbNumber(data.awb_number);
    setMessage(data.demo ? 'Validated in demo mode. Configure courier credentials and Supabase to persist.' : data.message || 'Shipment saved.');
  }

  async function openOrGenerateLabel(event) {
    event?.preventDefault();
    setMessage('');
    if (labelUrl) {
      window.open(labelUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!awbNumber) {
      setMessage('AWB is required before generating a shipping label.');
      return;
    }
    setLabelBusy(true);
    const response = await fetch(`/api/crm/orders/${order.id}/label`, { method: 'POST' });
    const data = await response.json();
    setLabelBusy(false);
    if (!response.ok) {
      setMessage(data.error || 'Label generation failed.');
      return;
    }
    if (data.label_url) {
      setLabelUrl(data.label_url);
      window.open(data.label_url, '_blank', 'noopener,noreferrer');
      setMessage('Label opened in a new tab.');
    } else {
      setMessage('No label URL was returned by the courier.');
    }
  }

  return (
    <form className="formGrid" action={`/api/crm/orders/${order.id}/shipment`} method="post" onSubmit={submit}>
      <input type="hidden" name="phone" value={order.phone || ''} />
      <input type="hidden" name="pincode" value={order.pincode || ''} />
      <input type="hidden" name="country" value={order.country || 'IN'} />
      <input type="hidden" name="address_line1" value={order.address_line1 || ''} />
      <label>
        <span>Pickup location</span>
        <input name="pickup_location" defaultValue="Hold My Throttle HQ" />
      </label>
      <label>
        <span>Courier</span>
        <select name="courier" value={courier} onChange={event => setCourier(event.target.value)}>
          {Array.from(new Set([order.courier, ...COURIERS].filter(Boolean))).map(courier => (
            <option value={courier} key={courier}>{courier.replaceAll('_', ' ')}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Service</span>
        <select name="service_code" defaultValue={services[0]?.code || 'manual'} disabled={!services.length}>
          {services.length ? services.map(service => (
            <option value={service.code} key={service.code}>{service.name}</option>
          )) : <option value="manual">Manual / not configured</option>}
        </select>
      </label>
      <label>
        <span>Package weight (grams)</span>
        <input name="weight_grams" type="number" defaultValue="500" />
      </label>
      <label>
        <span>Product value</span>
        <input name="product_value" type="number" defaultValue={order.order_value || ''} />
      </label>
      <label>
        <span>Length (cm)</span>
        <input name="length_cm" type="number" defaultValue="24" />
      </label>
      <label>
        <span>Width (cm)</span>
        <input name="width_cm" type="number" defaultValue="18" />
      </label>
      <label>
        <span>Height (cm)</span>
        <input name="height_cm" type="number" defaultValue="8" />
      </label>
      <label>
        <span>Payment mode</span>
        <select name="payment_mode" defaultValue="Prepaid">
          <option>Prepaid</option>
          <option>COD</option>
        </select>
      </label>
      <label>
        <span>AWB/manual override</span>
        <input name="awb_number" value={awbNumber} onChange={event => setAwbNumber(event.target.value)} placeholder="Optional when courier API returns AWB" />
      </label>
      <label>
        <span>Label URL</span>
        <input name="label_url" value={labelUrl} onChange={event => setLabelUrl(event.target.value)} placeholder="Supabase Storage or courier label URL" />
      </label>
      <label className="checkItem full">
        <input type="checkbox" name="insurance" />
        <span>Insurance option requested</span>
      </label>
      {selectedBookingCourier && !selectedBookingCourier.enabled ? (
        <p className="muted full">Direct API booking for {selectedBookingCourier.name} is not configured yet. Save the shipment with a manual AWB for now.</p>
      ) : null}
      <div className="toolbar full">
        <button type="submit" name="booking_action" value="book_courier" disabled={busy}>{busy ? 'Booking...' : 'Book courier'}</button>
        <button type="submit" name="booking_action" value="save_manual_awb" className="secondary" disabled={busy}>Save manual AWB</button>
        <button
          type="button"
          className="secondary"
          onClick={openOrGenerateLabel}
          disabled={labelBusy || !canGenerateLabel}
        >
          {labelBusy ? 'Generating...' : labelUrl ? 'Open label' : 'Generate label'}
        </button>
        {labelUrl ? <a className="button secondary" href={labelUrl} target="_blank" rel="noreferrer">Download label</a> : null}
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}
