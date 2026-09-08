'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FulfillShipmentButton } from './fulfill-shipment-button';
import { Search } from 'lucide-react';
import { StatusPill } from './status-pill';

export function ShipmentFilters({ query = '', status = '', courier = '' }) {
  return <form className="filters" action="/shipments">
    <input type="hidden" name="tab" value="all" />
    <label><span>Search</span><div style={{ position: 'relative' }}><Search size={16} style={{ left: 10, position: 'absolute', top: 11, color: '#667085' }} /><input name="q" defaultValue={query} placeholder="Name, phone, order, AWB" style={{ paddingLeft: 32 }} /></div></label>
    <label><span>Status</span><select name="status" defaultValue={status}><option value="">All statuses</option>{['shipment_booked', 'pickup_pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'rto', 'failed_delivery', 'cancelled', 'returned'].map(value => <option value={value} key={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
    <label><span>Courier</span><select name="courier" defaultValue={courier}><option value="">All couriers</option><option value="delhivery">Delhivery</option><option value="fedex">FedEx</option><option value="shiprocket">Shiprocket</option></select></label>
    <label><span>&nbsp;</span><button type="submit">Apply</button></label>
  </form>;
}

export function ShipmentList({ shipments }) {
  return <div className="tableWrap"><table><thead><tr><th>Shipment</th><th>Order / customer</th><th>Courier</th><th>Status</th><th>Package</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
    {shipments.map(shipment => <ShipmentRow shipment={shipment} key={shipment.id} />)}
    {!shipments.length ? <tr><td colSpan="7" className="empty">No matching shipments.</td></tr> : null}
  </tbody></table></div>;
}

function ShipmentRow({ shipment }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const status = String(shipment.status || '').toLowerCase();
  const canCancel = shipment.order_id && shipment.waybill && String(shipment.courier_code || '').toLowerCase() === 'delhivery' && !['delivered', 'cancelled', 'returned', 'rto'].includes(status);
  async function cancel() {
    if (!window.confirm(`Cancel Delhivery shipment ${shipment.waybill}? This cannot be undone.`)) return;
    setBusy(true); setMessage('');
    const response = await fetch(`/api/crm/orders/${shipment.order_id}/shipments/${shipment.id}/cancel`, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    setBusy(false); setMessage(result.message || result.error || 'Cancellation request finished.');
    if (result.ok) router.refresh();
  }
  const tracking = shipment.tracking_url || (shipment.waybill && String(shipment.courier_code).toLowerCase() === 'delhivery' ? `https://www.delhivery.com/track/package/${encodeURIComponent(shipment.waybill)}` : '');
  return <tr>
    <td><strong>{shipment.waybill || 'AWB pending'}</strong><span className="subtle">{shipment.shipment_type || shipment.direction || 'original'} · {shipment.flow || 'domestic'}</span></td>
    <td>{shipment.order_id ? <Link href={`/orders/${shipment.order_id}`}><strong>{shipment.order_number || 'Open order'}</strong></Link> : <strong>{shipment.order_number || '-'}</strong>}<span className="subtle">{[shipment.customer_name, shipment.customer_phone].filter(Boolean).join(' · ') || shipment.source || '-'}</span></td>
    <td><strong>{shipment.courier_code || '-'}</strong><span className="subtle">{shipment.service_code || shipment.courier_service_code || shipment.service_mode || '-'}</span></td>
    <td><StatusPill value={shipment.status || 'not_set'} />{shipment.error || shipment.label_error ? <span className="subtle dangerText">{shipment.error || shipment.label_error}</span> : null}</td>
    <td>{shipment.weight_grams ? `${shipment.weight_grams} g` : '-'}<span className="subtle">{[shipment.length_cm, shipment.width_cm, shipment.height_cm].every(Boolean) ? `${shipment.length_cm} × ${shipment.width_cm} × ${shipment.height_cm} cm` : ''}</span></td>
    <td>{shipment.updated_at ? new Date(shipment.updated_at).toLocaleString('en-IN') : '-'}</td>
    <td><div className="shipmentActions"><FulfillShipmentButton orderId={shipment.order_id} shipment={shipment} />{tracking ? <a className="button secondary" href={tracking} target="_blank" rel="noreferrer">Track</a> : null}{shipment.label_url ? <a className="button secondary" href={shipment.label_url} target="_blank" rel="noreferrer">Label</a> : null}{canCancel ? <button type="button" className="danger" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel'}</button> : null}{message ? <small className={message.toLowerCase().includes('accepted') ? 'muted' : 'dangerText'}>{message}</small> : null}</div></td>
  </tr>;
}
