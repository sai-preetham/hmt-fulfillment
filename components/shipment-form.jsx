'use client';

import { useState } from 'react';
import { BOOKING_COURIERS, COURIERS } from '@/lib/crm/constants';

export function ShipmentForm({ order, shipments = [], packageDefaults = {} }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const [rateBusy, setRateBusy] = useState(false);
  const [fedexRate, setFedexRate] = useState(null);
  const [courier, setCourier] = useState(order.courier || defaultCourierForOrder(order));
  const [shipmentType, setShipmentType] = useState('original');
  const [labelUrl, setLabelUrl] = useState(order.label_url || '');
  const [awbNumber, setAwbNumber] = useState(order.awb_number || '');
  const selectedBookingCourier = BOOKING_COURIERS.find(item => item.code === courier);
  const services = selectedBookingCourier?.services || [];
  const canGenerateLabel = Boolean(labelUrl || awbNumber);
  const hasExistingShipment = Boolean(shipments.length || order.awb_number || order.shipment_status === 'shipment_booked');
  const wixShipmentAvailable = Boolean(order.wix_fulfillment_id || order.awb_number || order.tracking_url);

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    const submitter = event.nativeEvent.submitter;
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    if (submitter?.name) body[submitter.name] = submitter.value;
    if (body.booking_action === 'book_courier' && hasExistingShipment && shipmentType === 'original') {
      const confirmed = window.confirm(
        `This order already has a booked shipment${order.awb_number ? ` (${order.awb_number})` : ''}. Book another shipment with a new Delhivery order number?`
      );
      if (!confirmed) return;
      body.allow_multiple_shipments = 'true';
    }
    if (shipmentType !== 'original') body.allow_multiple_shipments = 'true';
    if (['reverse', 'rto'].includes(shipmentType)) body.service_code = 'reverse_pickup';
    setBusy(true);
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

  function downloadFedexTemplate(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget.form);
    const params = new URLSearchParams();
    for (const key of ['weight_grams', 'length_cm', 'width_cm', 'height_cm', 'product_value']) {
      const value = form.get(key);
      if (value) params.set(key, value);
    }
    params.set('_', String(Date.now()));
    window.location.href = `/api/crm/orders/${order.id}/fedex-template?${params.toString()}`;
  }

  async function getFedexEstimate(event) {
    event.preventDefault();
    setMessage('');
    setFedexRate(null);
    const form = new FormData(event.currentTarget.form);
    const body = Object.fromEntries(['weight_grams', 'length_cm', 'width_cm', 'height_cm', 'product_value'].map(key => [key, form.get(key)]));
    setRateBusy(true);
    const response = await fetch(`/api/crm/orders/${order.id}/fedex-rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    setRateBusy(false);
    if (!response.ok || !data.ok) {
      setMessage(data.error || 'FedEx estimate failed.');
      return;
    }
    const quote = data.quotes?.[0] || null;
    setFedexRate(quote);
    setMessage(quote ? 'FedEx estimate loaded.' : 'FedEx returned no rate quotes for this shipment.');
  }

  return (
    <form className="formGrid shipmentBookingForm" action={`/api/crm/orders/${order.id}/shipment`} method="post" onSubmit={submit}>
      <input type="hidden" name="phone" value={order.phone || ''} />
      <input type="hidden" name="pincode" value={order.pincode || ''} />
      <input type="hidden" name="country" value={order.country || 'IN'} />
      <input type="hidden" name="address_line1" value={order.address_line1 || ''} />
      <div className="shipmentSource full">
        <div>
          <strong>{wixShipmentAvailable ? 'Wix shipment data found' : 'No Wix shipment found'}</strong>
          <p className="muted">{wixShipmentAvailable ? [order.courier, order.awb_number, order.wix_fulfillment_id].filter(Boolean).join(' · ') : 'Book a new shipment or save a manual AWB below.'}</p>
        </div>
        {order.tracking_url ? <a className="button secondary" href={order.tracking_url} target="_blank" rel="noreferrer">Open Wix tracking</a> : null}
      </div>
      <label>
        <span>Shipment purpose</span>
        <select name="shipment_type" value={shipmentType} onChange={event => setShipmentType(event.target.value)}>
          <option value="original">Original order</option>
          <option value="replacement">Replacement outbound</option>
          <option value="reverse">Reverse pickup</option>
          <option value="rto">RTO movement</option>
        </select>
      </label>
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
        <select name="service_code" value={['reverse', 'rto'].includes(shipmentType) ? 'reverse_pickup' : undefined} defaultValue={services[0]?.code || 'manual'} disabled={!services.length || ['reverse', 'rto'].includes(shipmentType)}>
          {services.length ? services.map(service => (
            <option value={service.code} key={service.code}>{service.name}</option>
          )) : <option value="manual">Manual / not configured</option>}
        </select>
      </label>
      <label>
        <span>Package weight (grams)</span>
        <input name="weight_grams" type="number" min="1" step="1" defaultValue={packageDefaults.weightGrams || 400} />
      </label>
      <label>
        <span>Product value</span>
        <input name="product_value" type="number" defaultValue={order.order_value || ''} />
      </label>
      <label>
        <span>Length (cm)</span>
        <input name="length_cm" type="number" min="0.1" step="0.1" defaultValue={packageDefaults.lengthCm || 23} />
      </label>
      <label>
        <span>Width (cm)</span>
        <input name="width_cm" type="number" min="0.1" step="0.1" defaultValue={packageDefaults.widthCm || 14} />
      </label>
      <label>
        <span>Height (cm)</span>
        <input name="height_cm" type="number" min="0.1" step="0.1" defaultValue={packageDefaults.heightCm || 6} />
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
        <button type="submit" name="booking_action" value="book_courier" disabled={busy}>{busy ? 'Booking...' : `Book ${shipmentType === 'original' ? 'shipment' : shipmentType}`}</button>
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
        {courier === 'fedex' ? (
          <>
            <button type="button" className="secondary" onClick={getFedexEstimate} disabled={rateBusy}>
              {rateBusy ? 'Checking FedEx...' : 'Get FedEx estimate'}
            </button>
            <button type="button" className="secondary" onClick={downloadFedexTemplate}>
              Generate FedEx Excel
            </button>
          </>
        ) : null}
        {message ? <span className="muted">{message}</span> : null}
      </div>
      {courier === 'fedex' && fedexRate ? (
        <div className="shipmentSource full">
          <div>
            <strong>{fedexRate.currency && fedexRate.amount !== '' ? `${fedexRate.currency} ${fedexRate.amount}` : 'FedEx rate returned'}</strong>
            <p className="muted">
              {[fedexRate.serviceName, fedexRate.rateType, fedexRate.transitTime, fedexRate.commitmentDate].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function defaultCourierForOrder(order = {}) {
  const country = String(order.shipping_country || order.country || 'IN').trim().toUpperCase();
  return country && country !== 'IN' && country !== 'INDIA' ? 'fedex' : 'delhivery';
}
