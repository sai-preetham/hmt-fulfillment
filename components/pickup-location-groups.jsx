'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatusPill } from './status-pill';

/** Default Delhivery pickup slot: 16:00 Asia/Kolkata. After 16:00 IST, use tomorrow 16:00. */
export function defaultPickupWindow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now).map(part => [part.type, part.value])
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);
  if (hour > 16 || (hour === 16 && minute > 0)) {
    const next = new Date(Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: '16:00'
  };
}

export function PickupWorkspace({ workspace }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const { needsPickup = [], pickedUp = [], exceptions = [], updatedAt } = workspace || {};
  const awaitingCount = needsPickup.reduce((total, group) => total + group.shipments.length, 0);
  async function refresh() {
    setRefreshing(true); setRefreshMessage('');
    try {
      const response = await fetch('/api/crm/pickups/refresh', { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) setRefreshMessage(result.tracking?.lastError || 'Live tracking refresh failed.');
      else { setRefreshMessage(`Live status updated for ${result.tracking?.lastPolled || 0} shipments.`); router.refresh(); }
    } catch { setRefreshMessage('Could not refresh live carrier status.'); } finally { setRefreshing(false); }
  }
  return <>
    <section className="pickupHero panel"><div><p className="eyebrow">Live AWB control room</p><h2>{awaitingCount} awaiting pickup · {pickedUp.length} picked up</h2><p className="muted">Last carrier update: {updatedAt ? new Date(updatedAt).toLocaleString('en-IN') : 'Not available yet'}</p></div><div className="toolbar"><button type="button" className="secondary" onClick={refresh} disabled={refreshing}>{refreshing ? <><span className="buttonSpinner" aria-hidden="true" />Refreshing live status…</> : 'Refresh live AWB status'}</button></div></section>
    {refreshMessage ? <p className={refreshMessage.includes('failed') || refreshMessage.includes('Could not') ? 'dangerText' : 'muted'}>{refreshMessage}</p> : null}
    <section className="pickupSection"><div className="panelHeader"><div><p className="eyebrow">Action required</p><h2>Needs pickup</h2><p className="muted">Grouped by collection location. One click raises pickup at 16:00 IST (today, or tomorrow if it is already past 16:00).</p></div></div><PickupLocationGroups groups={needsPickup} /></section>
    <ShipmentStatusSection title="Already picked up" description="Carrier has confirmed pickup or moved the shipment into a later delivery stage." shipments={pickedUp} empty="No Delhivery shipments have been confirmed picked up yet." />
    <ShipmentStatusSection title="Pickup exceptions" description="Investigate failed pickup, cancellation, or return statuses before creating another request." shipments={exceptions} empty="No pickup exceptions." danger />
  </>;
}

export function PickupLocationGroups({ groups = [] }) {
  return <div className="pickupLocationGroups">
    {groups.map(group => <PickupLocationGroup group={group} key={group.location} />)}
    {!groups.length ? <p className="empty">No booked Delhivery shipments are waiting for a pickup request.</p> : null}
  </div>;
}

function PickupLocationGroup({ group }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const canRequest = group.location !== 'Unassigned pickup location';

  async function requestPickup() {
    const defaults = defaultPickupWindow();
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/crm/pickups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickup_location: group.location, pickup_date: defaults.date, pickup_time: defaults.time })
      });
      const result = await response.json().catch(() => ({}));
      setMessage(result.message || result.error || 'Pickup request finished.');
      if (result.ok) router.refresh();
    } catch {
      setMessage('Pickup request could not be completed. Please try again.');
    } finally { setBusy(false); }
  }

  return <section className="panel pickupLocationGroup">
    <div className="panelHeader"><div><h2>{group.location}</h2><p className="muted">{group.requestableCount} ready to request · {group.requestedCount} request pending</p></div>{canRequest && group.requestableCount ? <button type="button" onClick={requestPickup} disabled={busy} aria-busy={busy}>{busy ? <><span className="buttonSpinner" aria-hidden="true" />Raising pickup…</> : `Request pickup (${group.requestableCount})`}</button> : null}</div>
    <div className="tableWrap"><table><thead><tr><th>AWB</th><th>Order / customer</th><th>Package</th><th>Status</th></tr></thead><tbody>{group.shipments.map(shipment => <tr key={shipment.id}><td><strong>{shipment.waybill}</strong></td><td><Link href={`/orders/${shipment.order_id}`}><strong>{shipment.order_number || 'Open order'}</strong></Link><span className="subtle">{[shipment.customer_name, shipment.customer_phone].filter(Boolean).join(' · ') || '-'}</span></td><td>{shipment.weight_grams ? `${shipment.weight_grams} g` : '-'}</td><td><StatusPill value={shipment.status} /></td></tr>)}</tbody></table></div>
    {message ? <p className={String(message).toLowerCase().includes('fail') || String(message).toLowerCase().includes('could not') ? 'dangerText' : 'muted'}>{message}</p> : null}
  </section>;
}

function ShipmentStatusSection({ title, description, shipments = [], empty, danger = false }) {
  return <section className="panel pickupStatusSection"><div className="panelHeader"><div><h2>{title}</h2><p className="muted">{description}</p></div><span className={danger ? 'pill danger' : 'pill ok'}>{shipments.length}</span></div>{shipments.length ? <div className="tableWrap"><table><thead><tr><th>AWB</th><th>Order / customer</th><th>Pickup location</th><th>Live status</th><th>Last update</th></tr></thead><tbody>{shipments.map(shipment => <tr key={shipment.id}><td><strong>{shipment.waybill}</strong></td><td><Link href={`/orders/${shipment.order_id}`}><strong>{shipment.order_number || 'Open order'}</strong></Link><span className="subtle">{[shipment.customer_name, shipment.customer_phone].filter(Boolean).join(' · ') || '-'}</span></td><td>{shipment.pickup_location || '-'}</td><td><StatusPill value={shipment.status} /></td><td>{shipment.updated_at ? new Date(shipment.updated_at).toLocaleString('en-IN') : '-'}</td></tr>)}</tbody></table></div> : <p className="empty">{empty}</p>}</section>;
}
