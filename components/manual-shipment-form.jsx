'use client';

import { useState } from 'react';

export function ManualShipmentForm() {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [shipmentType, setShipmentType] = useState('original');
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setMessage('');
    const response = await fetch('/api/crm/shipments/manual', { method: 'POST', body: new FormData(form) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setMessage(result.error || result.validation?.join(', ') || 'Could not save shipment.'); return; }
    form.reset(); setMessage(result.demo ? 'Manual shipment validated in demo mode.' : 'Manual shipment saved.');
  }
  return <form className="formGrid" onSubmit={submit}>
    <Field name="awb_number" label="AWB / tracking number" required /><Field name="order_number" label="Order number" required /><Field name="customer_name" label="Recipient name" required /><Field name="phone" label="Recipient phone" required />
    <Field name="address_line1" label="Address" required /><Field name="city" label="City" /><Field name="state" label="State" /><Field name="pincode" label="Pincode" required /><Field name="product_value" label="Product value" type="number" value="1" required />
    <label><span>Courier</span><select name="courier" defaultValue="delhivery"><option value="delhivery">Delhivery</option><option value="fedex">FedEx</option><option value="shiprocket">Shiprocket</option><option value="other">Other</option></select></label>
    <label><span>Shipment purpose</span><select name="shipment_type" value={shipmentType} onChange={event => setShipmentType(event.target.value)}><option value="original">Original order</option><option value="replacement">Replacement outbound</option><option value="reverse">Reverse pickup</option><option value="rto">RTO movement</option></select></label>
    {shipmentType === 'replacement' ? <label><span>Replacement part</span><select name="replacement_part" required defaultValue=""><option value="" disabled>Select part</option><option value="full_kit">Full kit</option><option value="switch">Switch</option><option value="control_module">Control module</option><option value="harness">Harness</option></select></label> : null}
    <label><span>Payment mode</span><select name="payment_mode" defaultValue="Prepaid"><option>Prepaid</option><option>COD</option></select></label><Field name="weight_grams" label="Weight (grams)" type="number" value="400" /><Field name="length_cm" label="Length (cm)" type="number" value="23" /><Field name="width_cm" label="Width (cm)" type="number" value="14" /><Field name="height_cm" label="Height (cm)" type="number" value="6" />
    <label className="full"><span>Label URL (optional)</span><input name="label_url" type="url" /></label><label className="full"><span>Upload shipping label (optional)</span><input name="label_file" type="file" accept="application/pdf,image/png,image/jpeg" /><small className="muted">PDF, PNG, or JPEG; maximum 10 MB. Stored securely with this shipment.</small></label><div className="toolbar full"><button disabled={busy}>{busy ? 'Saving…' : 'Save manual shipment'}</button>{message ? <span className="muted">{message}</span> : null}</div>
  </form>;
}
function Field({ name, label, type = 'text', value = '', required = false }) { return <label><span>{label}</span><input name={name} type={type} defaultValue={value} required={required} /></label>; }
