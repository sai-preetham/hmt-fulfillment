'use client';

import { useEffect, useState } from 'react';

export function QuickBookButton({ order }) {
  const recommendation = recommendCourier(order);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadEstimate() {
      const response = await fetch(`/api/crm/orders/${order.id}/shipping-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_value: order.order_value, weight_grams: 400, length_cm: 23, width_cm: 14, height_cm: 6 })
      });
      const result = await response.json().catch(() => ({}));
      if (!active) return;
      if (response.ok) setEstimate(result.quote);
      else setEstimateError(result.error || 'Estimate unavailable');
    }
    loadEstimate();
    return () => { active = false; };
  }, [order.id, order.order_value]);

  async function quickBook() {
    const confirmed = window.confirm(
      `Book ${order.order_number || order.external_order_id} with ${recommendation.name}?\n\n` +
      `${recommendation.reason}\n` +
      'Package defaults: 400 g · 23 × 14 × 6 cm. You can change these from the order page.'
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage('');
    const response = await fetch(`/api/crm/orders/${order.id}/shipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_action: 'book_courier',
        courier: recommendation.code,
        service_code: recommendation.serviceCode,
        shipment_type: 'original',
        pickup_location: 'Hold My Throttle HQ',
        phone: order.phone || order.shipping_phone || '',
        pincode: order.pincode || order.shipping_pincode || '',
        country: order.country || order.shipping_country || 'IN',
        address_line1: order.address_line1 || order.shipping_address_line1 || '',
        product_value: order.order_value || '',
        weight_grams: 400,
        length_cm: 23,
        width_cm: 14,
        height_cm: 6,
        payment_mode: 'Prepaid'
      })
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage((result.validation || [result.error || 'Booking failed.']).join(' '));
      return;
    }
    setMessage(result.awb_number ? `Booked · AWB ${result.awb_number}` : result.message || 'Shipment queued.');
    window.location.reload();
  }

  return (
    <div className="quickBook">
      <span className="subtle">Recommended: {recommendation.name}</span>
      <span className="subtle">{recommendation.reason}</span>
      <span className="subtle">{estimate ? `Estimate: ${formatEstimate(estimate)}` : estimateError || 'Loading estimate…'}</span>
      <button type="button" onClick={quickBook} disabled={busy}>
        {busy ? 'Booking…' : `Quick book ${recommendation.name}`}
      </button>
      <a className="button secondary" href={`/orders/${order.id}`}>Edit</a>
      {message ? <span className="subtle">{message}</span> : null}
    </div>
  );
}

function formatEstimate(estimate) {
  const amount = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(estimate.amount));
  return `${estimate.currency || 'INR'} ${amount}${estimate.transit_time ? ` · ${estimate.transit_time}` : ''}`;
}

function recommendCourier(order) {
  const country = String(order.shipping_country || order.country || 'IN').trim().toUpperCase();
  if (country && !['IN', 'INDIA'].includes(country)) {
    return { code: 'fedex', name: 'FedEx', serviceCode: 'international_express', reason: 'International destination' };
  }
  return { code: 'delhivery', name: 'Delhivery', serviceCode: 'express', reason: 'Domestic destination' };
}
