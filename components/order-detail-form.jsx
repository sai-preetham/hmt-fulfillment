'use client';

import { useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { COURIERS, DELIVERY_METHODS, FEEDBACK_STATUSES, INSTALLATION_METHODS, INSTALLATION_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES } from '@/lib/crm/constants';

export function OrderDetailForm({ order, section = 'order', label }) {
  const dialogRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const title = label || SECTION_TITLES[section] || 'Order details';

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
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
    if (data.skipped_columns?.length) warnings.push(`Missing CRM columns: ${data.skipped_columns.join(', ')}`);
    if (warnings.length) {
      setMessage(`Saved with warnings. ${warnings.join(' ')}`);
      return;
    }
    dialogRef.current?.close();
    window.location.reload();
  }

  return (
    <>
      <button className="iconButton" type="button" title={`Edit ${title}`} aria-label={`Edit ${title}`} onClick={() => dialogRef.current?.showModal()}>
        <Pencil size={16} />
      </button>
      <dialog className="editDialog" ref={dialogRef} onClose={() => setMessage('')}>
        <div className="editDialogHeader">
          <div>
            <p className="eyebrow">Edit order</p>
            <h2>{title}</h2>
          </div>
          <button className="iconButton" type="button" title="Close" aria-label="Close" onClick={() => dialogRef.current?.close()}><X size={18} /></button>
        </div>
        <form className="formGrid editDialogForm" onSubmit={submit}>
          <SectionFields section={section} order={order} />
          <label className="full">
            <span>Internal change note</span>
            <textarea name="change_notes" placeholder="Reason for this update" />
          </label>
          <div className="toolbar full editDialogActions">
            <button type="button" className="secondary" onClick={() => dialogRef.current?.close()}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
            {message ? <span className="muted full">{message}</span> : null}
          </div>
        </form>
      </dialog>
    </>
  );
}

function SectionFields({ section, order }) {
  if (section === 'customer') return <>
    <Field name="customer_name" label="Customer name" value={order.customer_name} />
    <Field name="phone" label="Phone" value={order.phone} />
    <Field name="email" label="Email" value={order.email} />
    <Field name="buyer_gst" label="Buyer GST / VAT ID" value={order.buyer_gst} />
    <Field name="buyer_gst_type" label="GST / VAT type" value={order.buyer_gst_type || (order.buyer_gst ? 'GSTIN' : '')} />
  </>;
  if (section === 'addresses') return <>
    <FieldGroup title="Shipping address">
      <Field name="shipping_name" label="Recipient" value={order.shipping_name || order.customer_name} />
      <Field name="shipping_phone" label="Phone" value={order.shipping_phone || order.phone} />
      <Field name="shipping_address_line1" label="Address line 1" value={order.shipping_address_line1 || order.address_line1} />
      <Field name="shipping_address_line2" label="Address line 2" value={order.shipping_address_line2 || order.address_line2} />
      <Field name="shipping_city" label="City" value={order.shipping_city || order.city} />
      <Field name="shipping_state" label="State" value={order.shipping_state || order.state} />
      <Field name="shipping_pincode" label="Pincode" value={order.shipping_pincode || order.pincode} />
      <Field name="shipping_country" label="Country" value={order.shipping_country || order.country} />
    </FieldGroup>
    <FieldGroup title="Billing address">
      <Field name="billing_address_line1" label="Address line 1" value={order.billing_address_line1} />
      <Field name="billing_city" label="City" value={order.billing_city} />
      <Field name="billing_state" label="State" value={order.billing_state} />
      <Field name="billing_pincode" label="Pincode" value={order.billing_pincode} />
    </FieldGroup>
  </>;
  if (section === 'payment') return <>
    <Field name="order_value" label="Order value" type="number" value={order.order_value} />
    <Select name="payment_status" label="Payment status" value={order.payment_status} options={PAYMENT_STATUSES} />
  </>;
  if (section === 'delivery') return <>
    <Select name="delivery_method" label="Kit handoff" value={order.delivery_method} options={DELIVERY_METHODS} labels={DELIVERY_METHOD_LABELS} />
    <Select name="courier" label="Courier" value={order.courier} options={['', ...COURIERS]} />
    <Field name="awb_number" label="AWB / Porter reference" value={order.awb_number} />
    <Field name="tracking_url" label="Tracking link" value={order.tracking_url} />
  </>;
  if (section === 'installation') return <>
    <Select name="installation_method" label="Installation plan" value={order.installation_method} options={INSTALLATION_METHODS} labels={INSTALLATION_METHOD_LABELS} />
    <Select name="installation_status" label="Installation status" value={order.installation_status} options={INSTALLATION_STATUSES} />
    <Field name="install_location" label="Workshop / install location" value={order.install_location} />
    <Field name="garage_name" label="Garage name" value={order.garage_name} />
    <Field name="garage_contact_person" label="Garage contact" value={order.garage_contact_person} />
    <Field name="garage_phone" label="Garage phone" value={order.garage_phone} />
    <Field name="garage_address" label="Garage address" value={order.garage_address} />
    <Field name="garage_city" label="Garage city" value={order.garage_city} />
  </>;
  if (section === 'feedback') return <Select name="feedback_status" label="Feedback status" value={order.feedback_status} options={FEEDBACK_STATUSES} />;
  return <>
    <Field name="bike_model" label="Bike model" value={order.bike_model} />
    <Field name="product_variant" label="Product variant" value={order.product_variant} />
    <Field name="quantity" label="Quantity" type="number" value={order.quantity} />
    <Select name="internal_status" label="Order status" value={order.internal_status} options={ORDER_STATUSES} />
    <Field name="assigned_operator" label="Assigned operator" value={order.assigned_operator} />
    <Field name="tags" label="Tags" value={(order.tags || []).join(', ')} />
    <label className="full"><span>Notes</span><textarea name="notes" defaultValue={order.notes} /></label>
  </>;
}

function Field({ name, label, value = '', type = 'text' }) {
  return <label><span>{label}</span><input name={name} type={type} defaultValue={value || ''} /></label>;
}

function FieldGroup({ title, children }) {
  return <fieldset className="editFieldGroup"><legend>{title}</legend><div className="editFieldGrid">{children}</div></fieldset>;
}

function Select({ name, label, value = '', options, labels = {} }) {
  return <label><span>{label}</span><select name={name} defaultValue={value || ''}>{options.map(option => <option value={option} key={option}>{labels[option] || (option ? option.replaceAll('_', ' ') : 'Not set')}</option>)}</select></label>;
}

const SECTION_TITLES = { customer: 'Customer', addresses: 'Addresses', order: 'Order details', payment: 'Payment', delivery: 'Delivery / pickup', installation: 'Installation', feedback: 'Feedback' };
const DELIVERY_METHOD_LABELS = { unknown: 'Not selected', courier: 'Courier delivery', porter: 'Porter / Bengaluru quick delivery', hand_off: 'Customer pickup from workshop', install_at_hsr: 'Install directly at HSR workshop', install_at_cv_raman: 'Install directly at CV Raman Nagar workshop' };
const INSTALLATION_METHOD_LABELS = { unknown: 'Not selected', diy: 'Customer installs themselves', nearby_garage: 'Customer-selected garage', hmt_bengaluru_store: 'HMT Bengaluru workshop' };
