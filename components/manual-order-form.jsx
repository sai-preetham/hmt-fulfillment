'use client';

import { useState } from 'react';

export function ManualOrderForm() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/crm/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.duplicate ? `Duplicate suspected: ${data.duplicate.order_number}` : data.error || 'Could not create order');
      return;
    }
    event.currentTarget.reset();
    setMessage(data.demo ? 'Manual order validated in demo mode.' : 'Manual order created.');
  }

  return (
    <form className="formGrid" onSubmit={submit}>
      <Field name="external_order_id" label="External/manual ID" />
      <Field name="customer_name" label="Customer name" />
      <Field name="phone" label="Phone" />
      <Field name="email" label="Email" />
      <Field name="address_line1" label="Address" />
      <Field name="city" label="City" />
      <Field name="state" label="State" />
      <Field name="pincode" label="Pincode" />
      <Field name="bike_model" label="Bike model" />
      <Field name="product_variant" label="Product variant" />
      <Field name="quantity" label="Quantity" type="number" value="1" />
      <Field name="order_value" label="Order value" type="number" />
      <label>
        <span>Payment status</span>
        <select name="payment_status" defaultValue="PAID">
          <option value="PAID">Paid</option>
          <option value="APPROVED">Approved</option>
          <option value="NOT_PAID">Not paid</option>
          <option value="PENDING">Pending</option>
        </select>
      </label>
      <label className="full">
        <span>Notes</span>
        <textarea name="notes" />
      </label>
      <div className="toolbar full">
        <button disabled={busy}>{busy ? 'Creating...' : 'Create manual order'}</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}

function Field({ name, label, type = 'text', value = '' }) {
  return (
    <label>
      <span>{label}</span>
      <input name={name} type={type} defaultValue={value} />
    </label>
  );
}
