'use client';

import { useState } from 'react';
import { COURIERS, FEEDBACK_STATUSES, INSTALLATION_METHODS, INSTALLATION_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES, SHIPMENT_STATUSES } from '@/lib/crm/constants';

export function OrderDetailForm({ order }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    const response = await fetch(`/api/crm/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) {
      setMessage(data.error || 'Save failed.');
      return;
    }
    const warnings = [...(data.warnings || [])];
    if (data.skipped_columns?.length) warnings.push(`Some CRM columns are missing in Supabase: ${data.skipped_columns.join(', ')}`);
    setMessage(data.demo ? 'Saved in demo mode. Configure Supabase to persist changes.' : warnings.length ? `Order saved with warnings. ${warnings.join(' ')}` : 'Order saved.');
  }

  return (
    <form className="formGrid" onSubmit={submit}>
      <h3 className="formSection">Customer</h3>
      <Field name="customer_name" label="Customer name" value={order.customer_name} />
      <Field name="phone" label="Phone" value={order.phone} />
      <Field name="email" label="Email" value={order.email} />
      <Field name="buyer_gst" label="Buyer GST / VAT ID" value={order.buyer_gst} />
      <Field name="buyer_gst_type" label="GST / VAT type" value={order.buyer_gst_type || (order.buyer_gst ? 'GSTIN' : '')} />

      <h3 className="formSection">Shipping address</h3>
      <Field name="shipping_name" label="Ship to name" value={order.shipping_name || order.customer_name} />
      <Field name="shipping_phone" label="Ship to phone" value={order.shipping_phone || order.phone} />
      <Field name="shipping_address_line1" label="Shipping address 1" value={order.shipping_address_line1 || order.address_line1} />
      <Field name="shipping_address_line2" label="Shipping address 2" value={order.shipping_address_line2 || order.address_line2} />
      <Field name="shipping_city" label="Shipping city" value={order.shipping_city || order.city} />
      <Field name="shipping_state" label="Shipping state" value={order.shipping_state || order.state} />
      <Field name="shipping_pincode" label="Shipping pincode" value={order.shipping_pincode || order.pincode} />
      <Field name="shipping_country" label="Shipping country" value={order.shipping_country || order.country} />

      <h3 className="formSection">Billing address</h3>
      <Field name="billing_name" label="Bill to name" value={order.billing_name || order.customer_name} />
      <Field name="billing_phone" label="Bill to phone" value={order.billing_phone || order.phone} />
      <Field name="billing_address_line1" label="Billing address 1" value={order.billing_address_line1} />
      <Field name="billing_address_line2" label="Billing address 2" value={order.billing_address_line2} />
      <Field name="billing_city" label="Billing city" value={order.billing_city} />
      <Field name="billing_state" label="Billing state" value={order.billing_state} />
      <Field name="billing_pincode" label="Billing pincode" value={order.billing_pincode} />
      <Field name="billing_country" label="Billing country" value={order.billing_country || order.shipping_country || order.country} />

      <h3 className="formSection">Order</h3>
      <Field name="bike_model" label="Bike model" value={order.bike_model} />
      <Field name="product_variant" label="Product variant" value={order.product_variant} />
      <Field name="quantity" label="Quantity" type="number" value={order.quantity} />
      <Field name="order_value" label="Order value" type="number" value={order.order_value} />
      <Select name="payment_status" label="Payment status" value={order.payment_status} options={PAYMENT_STATUSES} />
      <Select name="internal_status" label="Order status" value={order.internal_status} options={ORDER_STATUSES} />
      <Select name="shipment_status" label="Shipment status" value={order.shipment_status} options={SHIPMENT_STATUSES} />
      <Select name="installation_status" label="Installation status" value={order.installation_status} options={INSTALLATION_STATUSES} />
      <Select name="installation_method" label="Installation method" value={order.installation_method} options={INSTALLATION_METHODS} />
      <Field name="install_location" label="Install location" value={order.install_location} />
      <Select name="feedback_status" label="Feedback status" value={order.feedback_status} options={FEEDBACK_STATUSES} />
      <Field name="garage_name" label="Garage name" value={order.garage_name} />
      <Field name="garage_contact_person" label="Garage contact person" value={order.garage_contact_person} />
      <Field name="garage_phone" label="Garage phone" value={order.garage_phone} />
      <Field name="garage_email" label="Garage email" value={order.garage_email} />
      <Field name="garage_address" label="Garage address" value={order.garage_address} />
      <Field name="garage_city" label="Garage city" value={order.garage_city} />
      <Field name="garage_state" label="Garage state" value={order.garage_state} />
      <Field name="garage_pincode" label="Garage pincode" value={order.garage_pincode} />
      <Select name="courier" label="Courier" value={order.courier} options={['', ...COURIERS]} />
      <Field name="awb_number" label="AWB" value={order.awb_number} />
      <Field name="tracking_url" label="Tracking link" value={order.tracking_url} />
      <Field name="assigned_operator" label="Assigned operator" value={order.assigned_operator} />
      <Field name="tags" label="Tags" value={(order.tags || []).join(', ')} />
      <label className="full">
        <span>Notes</span>
        <textarea name="notes" defaultValue={order.notes} />
      </label>
      <label className="full">
        <span>Internal change note</span>
        <textarea name="change_notes" placeholder="Reason for update, customer call summary, or manual override note" />
      </label>
      <div className="toolbar full">
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </form>
  );
}

function Field({ name, label, value = '', type = 'text' }) {
  return (
    <label>
      <span>{label}</span>
      <input name={name} type={type} defaultValue={value || ''} />
    </label>
  );
}

function Select({ name, label, value = '', options }) {
  return (
    <label>
      <span>{label}</span>
      <select name={name} defaultValue={value || ''}>
        {options.map(option => <option value={option} key={option}>{option ? option.replaceAll('_', ' ') : 'Not set'}</option>)}
      </select>
    </label>
  );
}
