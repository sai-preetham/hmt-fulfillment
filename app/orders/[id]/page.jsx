import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { OrderDetailForm } from '@/components/order-detail-form';
import { PackingForm } from '@/components/packing-form';
import { ShipmentForm } from '@/components/shipment-form';
import { StatusPill } from '@/components/status-pill';
import { COMMUNICATION_TYPES } from '@/lib/crm/constants';
import { formatCurrency, getOrder } from '@/lib/crm/data';

export default async function OrderDetailPage({ params, searchParams }) {
  const { id } = await params;
  const noticeParams = await searchParams;
  const detail = await getOrder(id);
  if (!detail) notFound();
  const { order } = detail;
  const chatwootUrl = order.chatwoot_conversation_id
    ? `${process.env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com'}/app/accounts/${process.env.CHATWOOT_ACCOUNT_ID || ''}/conversations/${order.chatwoot_conversation_id}`
    : '';
  const paid = ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status);
  const canPack = paid && ['new', 'awaiting_packing', 'packed'].includes(order.internal_status);
  const canBookShipment = paid && !['cancelled', 'not_paid', 'fulfilled_no_tracking', 'completed'].includes(order.internal_status);
  const communicationOptions = COMMUNICATION_TYPES.filter(([type]) => {
    if (type === 'tracking-link') return Boolean(order.tracking_url || order.awb_number);
    if (type === 'feedback-request' || type === 'review-request') return ['delivered', 'installation_pending', 'completed', 'fulfilled_no_tracking'].includes(order.internal_status) || order.shipment_status === 'delivered';
    return true;
  });

  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Order detail</p>
          <h1>{order.order_number || order.external_order_id}</h1>
          <p className="muted">{order.customer_name} · {order.bike_model} · {formatCurrency(order.order_value, order.currency)}</p>
        </div>
        <div className="toolbar">
          <Link className="button secondary" href={`/api/crm/orders/${order.id}/invoice`} target="_blank">Generate invoice</Link>
          <Link className="button secondary" href={`/api/crm/orders/${order.id}/invoice?format=international-label`} target="_blank">10x15 invoice</Link>
          {order.tracking_url ? <Link className="button secondary" href={order.tracking_url} target="_blank">Tracking</Link> : null}
          {chatwootUrl ? <Link className="button" href={chatwootUrl} target="_blank">Open Chatwoot</Link> : <span className="pill neutral">Chatwoot not linked</span>}
        </div>
      </header>

      {noticeParams?.shipment || noticeParams?.label || noticeParams?.error ? (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panelBody">
            <span className={noticeParams?.error ? 'pill danger' : 'pill ok'}>
              {noticeParams?.error || (noticeParams?.shipment === 'booked' ? 'Shipment booked' : 'Label generated')}
            </span>
          </div>
        </section>
      ) : null}

      <section className="grid metrics">
        <article className="card metric"><span>Order</span><StatusPill value={order.internal_status} /></article>
        <article className="card metric"><span>Shipment</span><StatusPill value={order.shipment_status} /></article>
        <article className="card metric"><span>Installation</span><StatusPill value={order.installation_status} /></article>
        <article className="card metric"><span>Feedback</span><StatusPill value={order.feedback_status} /></article>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panelHeader"><h2>Installation method</h2></div>
        <div className="panelBody">
          <div className="statusStack">
            <StatusPill value={order.installation_method || 'unknown'} />
            {order.install_location ? <span className="pill neutral">{order.install_location}</span> : null}
            {order.garage_name ? <span className="pill neutral">{order.garage_name}</span> : null}
            {order.garage_phone ? <span className="pill neutral">{order.garage_phone}</span> : null}
          </div>
        </div>
      </section>

      <section className="grid twoCol" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panelHeader"><h2>Editable order fields</h2></div>
          <div className="panelBody"><OrderDetailForm order={order} /></div>
        </div>
        <div className="grid">
          <section className="panel">
            <div className="panelHeader"><h2>Quick communications</h2></div>
            <div className="panelBody quickActions">
              {communicationOptions.map(([type, label]) => (
                <form action={`/api/crm/orders/${order.id}/communication`} method="post" key={type}>
                  <input type="hidden" name="type" value={type} />
                  <button type="submit" className="secondary">{label}</button>
                </form>
              ))}
              {!communicationOptions.length ? <span className="muted">No valid communication actions for this order yet.</span> : null}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader"><h2>Timeline</h2></div>
            <div className="panelBody timeline">
              {detail.timeline.map(item => (
                <div className="timelineItem" key={item.id}>
                  <strong>{String(item.event_type).replaceAll('_', ' ')}</strong>
                  <small>{item.created_at ? new Date(item.created_at).toLocaleString('en-IN') : ''} · {item.actor_name || 'System'}</small>
                  <p className="muted">{item.old_value ? `${item.old_value} -> ${item.new_value}. ` : ''}{item.notes}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="grid twoCol">
        <div className="panel">
          <div className="panelHeader"><h2>Packing checklist</h2></div>
          <div className="panelBody">
            {canPack ? <PackingForm order={order} checklist={detail.packingChecklist} /> : <p className="muted">Packing is not available for this order status.</p>}
          </div>
        </div>
        <div className="panel">
          <div className="panelHeader"><h2>Shipment booking</h2></div>
          <div className="panelBody">
            {canBookShipment ? <ShipmentForm order={order} /> : <p className="muted">Shipment booking is not available for this order status.</p>}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
