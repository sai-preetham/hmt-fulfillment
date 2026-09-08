import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { OrderDetailForm } from '@/components/order-detail-form';
import { OrderContents } from '@/components/order-contents';
import { PackingForm } from '@/components/packing-form';
import { ShipmentForm } from '@/components/shipment-form';
import { ShipmentActions } from '@/components/shipment-actions';
import { ShippingLabelUpload } from '@/components/shipping-label-upload';
import { StatusPill } from '@/components/status-pill';
import { COMMUNICATION_TYPES } from '@/lib/crm/constants';
import { formatCurrency, getOrder, shipmentFailureReason } from '@/lib/crm/data';
import { getCrmSettings } from '@/lib/crm/data-settings';

export default async function OrderDetailPage({ params, searchParams }) {
  const { id } = await params;
  const noticeParams = await searchParams;
  const [detail, crmSettings] = await Promise.all([getOrder(id), getCrmSettings()]);
  if (!detail) notFound();
  const { order } = detail;
  const chatwootUrl = order.chatwoot_conversation_id
    ? `${process.env.CHATWOOT_BASE_URL || 'https://app.chatwoot.com'}/app/accounts/${process.env.CHATWOOT_ACCOUNT_ID || ''}/conversations/${order.chatwoot_conversation_id}`
    : '';
  const paid = ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status);
  const canPack = paid && ['new', 'awaiting_packing', 'packed'].includes(order.internal_status);
  // A paid order may need additional shipment legs after its original fulfillment
  // (for example, a replacement, reverse pickup, or RTO). Keep booking available
  // for those orders; cancelled and unpaid orders remain ineligible.
  const canBookShipment = paid && !['cancelled', 'not_paid'].includes(order.internal_status);
  const communicationOptions = COMMUNICATION_TYPES.filter(([type]) => {
    if (type === 'tracking-link') return Boolean(order.tracking_url || order.awb_number);
    if (type === 'feedback-request' || type === 'review-request') return ['delivered', 'installation_pending', 'completed', 'fulfilled_no_tracking'].includes(order.internal_status);
    return true;
  });
  const shipments = [...(detail.shipments || [])].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  const latestShipment = shipments[0] || null;
  const openTasks = (detail.tasks || []).filter(task => !['done', 'closed', 'completed'].includes(String(task.status || '').toLowerCase()));
  const shippingAddress = [
    order.shipping_name || order.customer_name,
    order.shipping_phone || order.phone,
    order.shipping_address_line1 || order.address_line1,
    order.shipping_address_line2 || order.address_line2,
    [order.shipping_city || order.city, order.shipping_state || order.state, order.shipping_pincode || order.pincode].filter(Boolean).join(', '),
    order.shipping_country || order.country
  ].filter(Boolean);
  const billingAddress = [
    order.billing_name,
    order.billing_phone,
    order.billing_address_line1,
    order.billing_address_line2,
    [order.billing_city, order.billing_state, order.billing_pincode].filter(Boolean).join(', '),
    order.billing_country
  ].filter(Boolean);
  const trackingUrl = order.tracking_url || latestShipment?.tracking_url || latestShipment?.trackingUrl || '';
  const awb = order.awb_number || latestShipment?.waybill || latestShipment?.awb_number || '';
  const courier = order.courier || latestShipment?.courier_code || latestShipment?.courier || '';
  const labelUrl = order.label_url || latestShipment?.label_url || (latestShipment?.id ? `/api/crm/shipments/${latestShipment.id}/label-file` : '');
  const deliveryMode = deliveryModeDetails(order.delivery_method);
  const installationMode = installationModeDetails(order.installation_method, order.install_location);

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
          {labelUrl ? <Link className="button secondary" href={labelUrl} target="_blank">Shipping label</Link> : null}
          <ShippingLabelUpload orderId={order.id} shipments={shipments} />
          {trackingUrl ? <Link className="button secondary" href={trackingUrl} target="_blank">Tracking</Link> : null}
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
        <article className="card metric"><span>Status</span><StatusPill value={order.internal_status} /></article>
        <article className="card metric"><span>Fulfillment</span><StatusPill value={order.fulfillment_status || order.wix_fulfillment_status || 'not_fulfilled'} /><small>{order.wix_fulfillment_id || 'No Wix fulfillment ID'}</small></article>
        <article className="card metric">
          <span>Tracking</span>
          <strong>{courier || 'No courier'}</strong>
          <small>{awb || 'No AWB'}</small>
        </article>
        <article className="card metric"><span>Wix delivery option</span><strong>{order.selected_shipping_title || 'Not provided'}</strong><small>{order.shipping_amount ? formatCurrency(order.shipping_amount, order.currency) : 'No shipping charge recorded'}</small></article>
        <article className="card metric"><span>Shipment</span><StatusPill value={order.shipment_status || latestShipment?.status || 'not_booked'} /><small>{formatDateTime(order.shipment_booked_at || latestShipment?.created_at) || 'Not booked'}</small></article>
        <article className="card metric"><span>Installation</span><StatusPill value={order.installation_status} /></article>
        <article className="card metric"><span>Feedback</span><StatusPill value={order.feedback_status} /></article>
        <article className="card metric"><span>Payment</span><StatusPill value={order.payment_status || detail.payment?.payment_status || 'not_set'} /><small>{formatCurrency(detail.payment?.paid_amount || order.order_value, order.currency)}</small></article>
        <article className="card metric"><span>Open work</span><strong>{openTasks.length}</strong><small>{order.assigned_operator || 'No owner assigned'}</small></article>
      </section>

      <section className="grid orderOpsGrid">
        <div className="panel opsMain">
          <div className="panelHeader">
            <h2>Operations snapshot</h2>
            <div className="statusStack">
              <OrderDetailForm order={order} section="customer" />
              <OrderDetailForm order={order} section="addresses" />
              <OrderDetailForm order={order} section="order" />
              {order.source ? <span className="pill neutral">{order.source}</span> : null}
              {order.tags?.map(tag => <span className="pill neutral" key={tag}>{tag}</span>)}
            </div>
          </div>
          <div className="panelBody opsSnapshot">
            <InfoBlock title="Customer" rows={[
              order.customer_name,
              order.phone,
              order.email,
              order.buyer_gst ? `${order.buyer_gst_type || 'Tax ID'}: ${order.buyer_gst}` : ''
            ]} />
            <InfoBlock title="Ship to" rows={shippingAddress} />
            <InfoBlock title="Bill to" rows={billingAddress.length ? billingAddress : ['Same as shipping or not provided']} />
          </div>
        </div>

        <div className="grid opsSide">
          <section className="panel">
            <div className="panelHeader"><h2>Fulfillment</h2></div>
            <div className="panelBody detailList">
              <DetailRow label="Wix status" value={<StatusPill value={order.wix_fulfillment_status || order.fulfillment_status || 'not_fulfilled'} />} />
              <DetailRow label="Fulfillment ID" value={order.wix_fulfillment_id || '-'} />
              <DetailRow label="Synced" value={formatDateTime(order.wix_fulfillment_synced_at) || '-'} />
              <DetailRow label="Sync error" value={order.wix_fulfillment_error || '-'} danger={Boolean(order.wix_fulfillment_error)} />
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader"><h2>Payment</h2><OrderDetailForm order={order} section="payment" /></div>
            <div className="panelBody detailList">
              <DetailRow label="Status" value={<StatusPill value={detail.payment?.payment_status || order.payment_status || 'not_set'} />} />
              <DetailRow label="Method" value={detail.payment?.payment_method || '-'} />
              <DetailRow label="Paid" value={formatCurrency(detail.payment?.paid_amount || order.order_value, detail.payment?.currency || order.currency)} />
              <DetailRow label="Refunded" value={detail.payment ? formatCurrency(detail.payment.refunded_amount, detail.payment.currency || order.currency) : '-'} />
              <DetailRow label="Transaction" value={detail.payment?.transaction_ref || '-'} />
            </div>
          </section>
        </div>
      </section>

      <section className="workflowGrid">
        <article className="panel workflowPanel deliveryWorkflow">
          <div className="panelHeader">
            <div>
              <p className="workflowStep">1 · Kit handoff</p>
              <h2>Delivery / pickup</h2>
            </div>
            <div className="statusStack"><StatusPill value={order.shipment_status || latestShipment?.status || 'not_booked'} /><OrderDetailForm order={order} section="delivery" /></div>
          </div>
          <div className="panelBody workflowBody">
            <div className="workflowLead">
              <strong>{deliveryMode.label}</strong>
              <p className="muted">{deliveryMode.description}</p>
            </div>
            <div className="detailList">
              <DetailRow label="Destination" value={deliveryDestination(order.delivery_method, shippingAddress, order.install_location)} />
              {order.delivery_method === 'porter' ? <DetailRow label="Local delivery" value="Porter / same-day Bengaluru" /> : null}
              {order.delivery_method === 'courier' ? <DetailRow label="Courier and AWB" value={[courier, awb].filter(Boolean).join(' · ') || 'Not booked'} /> : null}
              <DetailRow label="Fulfillment" value={<StatusPill value={order.fulfillment_status || order.wix_fulfillment_status || 'not_fulfilled'} />} />
            </div>
          </div>
        </article>

        <article className="panel workflowPanel installationWorkflow">
          <div className="panelHeader">
            <div>
              <p className="workflowStep">2 · Fitment</p>
              <h2>Installation</h2>
            </div>
            <div className="statusStack"><StatusPill value={order.installation_status || 'not_contacted'} /><OrderDetailForm order={order} section="installation" /></div>
          </div>
          <div className="panelBody workflowBody">
            <div className="workflowLead">
              <strong>{installationMode.label}</strong>
              <p className="muted">{installationMode.description}</p>
            </div>
            <div className="detailList">
              <DetailRow label="Install location" value={order.install_location || installationMode.location || '-'} />
              {order.installation_method === 'nearby_garage' ? <DetailRow label="Garage" value={[order.garage_name, order.garage_contact_person, order.garage_phone].filter(Boolean).join(' · ') || 'Garage details required'} /> : null}
              {order.installation_method === 'nearby_garage' ? <DetailRow label="Garage address" value={[order.garage_address, order.garage_city, order.garage_state, order.garage_pincode].filter(Boolean).join(', ') || '-'} /> : null}
            </div>
          </div>
        </article>

        <article className="panel workflowPanel feedbackWorkflow">
          <div className="panelHeader">
            <div>
              <p className="workflowStep">3 · Follow-up</p>
              <h2>Feedback</h2>
            </div>
            <div className="statusStack"><StatusPill value={order.feedback_status || 'feedback_pending'} /><OrderDetailForm order={order} section="feedback" /></div>
          </div>
          <div className="panelBody workflowBody">
            <div className="workflowLead">
              <strong>{feedbackLabel(order.feedback_status)}</strong>
              <p className="muted">Track the post-install experience separately from delivery and fitment.</p>
            </div>
            <div className="detailList">
              <DetailRow label="Installation state" value={<StatusPill value={order.installation_status || 'not_contacted'} />} />
              <DetailRow label="Last communication" value={formatDateTime(order.last_communication_at) || 'No follow-up recorded'} />
              <DetailRow label="Issue" value={order.feedback_status === 'issue_escalated' ? 'Escalation required' : 'No escalated issue'} danger={order.feedback_status === 'issue_escalated'} />
            </div>
          </div>
        </article>
      </section>

      <section className="panel shippingWorkspace">
          <div className="panelHeader">
            <div>
              <p className="workflowStep">Shipping workspace</p>
              <h2>Shipments, booking and tracking</h2>
            </div>
            <div className="statusStack">
              <span className="pill info">Automatic tracking</span>
              <StatusPill value={order.shipment_status || latestShipment?.status || 'not_booked'} />
            </div>
          </div>
          <div className="panelBody">
            <div className="shippingOverview">
              <DetailRow label="Courier" value={courier || '-'} />
              <DetailRow label="Wix delivery option" value={order.selected_shipping_title || '-'} />
              <DetailRow label="AWB" value={awb || '-'} />
              <DetailRow label="Current status" value={<StatusPill value={order.shipment_status || latestShipment?.status || 'not_booked'} />} />
              <DetailRow label="Tracking link" value={trackingUrl ? <Link href={trackingUrl} target="_blank">Open tracking</Link> : '-'} />
              <DetailRow label="Label" value={labelUrl ? <Link href={labelUrl} target="_blank">Open label</Link> : order.label_error || latestShipment?.label_error || '-'} danger={Boolean(order.label_error || latestShipment?.label_error)} />
              <DetailRow label="Wix fulfillment" value={order.wix_fulfillment_id || 'Not available'} />
            </div>
            <div className="shippingWorkspaceGrid">
              <div className="shipmentHistory">
                <h3>All shipment legs</h3>
            {shipments.length ? (
              <div className="tableWrap compactTable">
                <table>
                  <thead>
                    <tr>
                      <th>Updated</th>
                      <th>Purpose</th>
                      <th>Courier</th>
                      <th>AWB</th>
                      <th>Status</th>
                      <th>Service</th>
                      <th>Reason</th>
                      <th>Label</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shipments.map(shipment => (
                      <tr key={shipment.id || `${shipment.waybill}-${shipment.created_at}`}>
                        <td>{formatDateTime(shipment.updated_at || shipment.created_at) || '-'}</td>
                        <td><span className="pill neutral">{shipmentTypeLabel(shipment.shipment_type, shipment.direction, shipment.carrier_response?.replacement_part)}</span></td>
                        <td>{shipment.courier_code || shipment.courier || '-'}</td>
                        <td>{shipment.waybill || shipment.awb_number || '-'}</td>
                        <td><StatusPill value={shipment.status || 'not_set'} /></td>
                        <td>{shipment.service_code || shipment.service_mode || '-'}</td>
                        <td className={shipmentFailureReason(shipment) ? 'dangerText' : ''}>{shipmentFailureReason(shipment) || '-'}</td>
                        <td>{shipment.label_url ? <Link href={shipment.label_url} target="_blank">Open</Link> : shipment.label_error || '-'}</td>
                        <td><ShipmentActions orderId={order.id} shipment={shipment} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">No shipment records yet.</p>}
              </div>
              <div className="shipmentBooking">
                <h3>Book another shipment</h3>
                {canBookShipment ? <ShipmentForm order={order} shipments={shipments} packageDefaults={crmSettings.shipment_defaults.domestic} pickupLocation={crmSettings.pickup_defaults.pickupLocation} /> : <p className="muted">Shipment booking is not available for this order status.</p>}
              </div>
            </div>
          </div>
      </section>

      <section className="grid twoCol">
        <div className="grid">
          <section className="panel">
            <div className="panelHeader"><h2>Open tasks</h2></div>
            <div className="panelBody taskList">
              {openTasks.length ? openTasks.map(task => (
                <div className="taskRow" key={task.id}>
                  <strong>{task.title}</strong>
                  <small>{task.assigned_operator || 'Unassigned'} · {task.priority || 'normal'} · {formatDate(task.due_date) || 'No due date'}</small>
                  {task.notes ? <p className="muted">{task.notes}</p> : null}
                </div>
              )) : <p className="muted">No open tasks for this order.</p>}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeader"><h2>Notes</h2></div>
            <div className="panelBody taskList">
              {detail.notes?.length ? detail.notes.map(note => (
                <div className="taskRow" key={note.id}>
                  <strong>{note.actor_name || 'Operator'}</strong>
                  <small>{formatDateTime(note.created_at)}</small>
                  <p className="muted">{note.body || note.note || note.notes}</p>
                </div>
              )) : <p className="muted">{order.notes || 'No notes recorded.'}</p>}
            </div>
          </section>
        </div>
        <section className="panel">
          <div className="panelHeader"><h2>Shipment timeline</h2></div>
          <div className="panelBody timeline">
            {detail.timeline.filter(item => String(item.event_type || '').includes('ship')).map(item => (
              <div className="timelineItem" key={item.id}>
                <strong>{String(item.event_type).replaceAll('_', ' ')}</strong>
                <small>{formatDateTime(item.created_at)} · {item.actor_name || 'System'}</small>
                <p className="muted">{item.notes || 'Shipment updated.'}</p>
              </div>
            ))}
            {!detail.timeline.some(item => String(item.event_type || '').includes('ship')) ? <p className="muted">Shipment activity will appear here automatically.</p> : null}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Order contents</h2></div>
        <div className="panelBody">
          <OrderContents order={order} items={detail.items} />
        </div>
      </section>

      <section className="grid twoCol">
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
      </section>
    </AppShell>
  );
}

function InfoBlock({ title, rows }) {
  const visibleRows = rows.filter(Boolean);
  return (
    <section className="infoBlock">
      <h3>{title}</h3>
      {visibleRows.map((row, index) => <p key={`${title}-${index}`}>{row}</p>)}
    </section>
  );
}

function DetailRow({ label, value, danger = false }) {
  return (
    <div className="detailRow">
      <span>{label}</span>
      <strong className={danger ? 'dangerText' : ''}>{value}</strong>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function deliveryModeDetails(value) {
  const modes = {
    courier: ['Courier delivery', 'Ship the kit to the customer or their chosen garage.'],
    porter: ['Bengaluru quick delivery', 'Send the kit locally using Porter or another same-day service.'],
    hand_off: ['Workshop pickup', 'Customer collects the kit from an HMT workshop.'],
    install_at_hsr: ['HSR workshop handoff', 'Kit stays at HSR for direct installation.'],
    install_at_cv_raman: ['CV Raman Nagar handoff', 'Kit stays at CV Raman Nagar for direct installation.'],
    unknown: ['Handoff not selected', 'Choose how the customer will receive the kit.']
  };
  const [label, description] = modes[value] || modes.unknown;
  return { label, description };
}

function installationModeDetails(value, location) {
  const modes = {
    diy: ['Self installation', 'Customer receives the kit and installs it themselves.', location],
    nearby_garage: ['Customer-selected garage', 'Deliver to the customer or garage for third-party fitment.', location],
    hmt_bengaluru_store: ['HMT workshop installation', 'Customer visits an HMT Bengaluru workshop for fitment.', location || 'HMT Bengaluru workshop'],
    unknown: ['Installation plan not selected', 'Confirm whether this is self-install, garage, or HMT workshop fitment.', location]
  };
  const [label, description, resolvedLocation] = modes[value] || modes.unknown;
  return { label, description, location: resolvedLocation };
}

function deliveryDestination(method, shippingAddress, installLocation) {
  if (method === 'install_at_hsr') return 'HMT HSR workshop';
  if (method === 'install_at_cv_raman') return 'HMT CV Raman Nagar workshop';
  if (method === 'hand_off') return installLocation || 'HMT workshop';
  return shippingAddress.slice(2).join(', ') || 'Address required';
}

function feedbackLabel(value) {
  const labels = {
    feedback_pending: 'Feedback pending',
    positive_feedback: 'Positive feedback received',
    negative_feedback: 'Negative feedback received',
    review_requested: 'Review requested',
    review_received: 'Review received',
    ugc_received: 'Customer content received',
    issue_escalated: 'Issue escalated'
  };
  return labels[value] || 'Feedback not started';
}

function shipmentTypeLabel(type, direction, replacementPart = '') {
  if (type === 'replacement') {
    const part = String(replacementPart || '').replaceAll('_', ' ').trim();
    return part ? `Replacement · ${part.replace(/\b\w/g, character => character.toUpperCase())}` : 'Replacement';
  }
  if (type === 'reverse') return 'Reverse pickup';
  if (type === 'rto') return 'RTO';
  if (direction === 'reverse') return 'Reverse';
  return 'Original';
}
