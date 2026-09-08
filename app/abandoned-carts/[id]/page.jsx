import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { AbandonedCartLeadForm } from '@/components/abandoned-cart-lead-form';
import { getAbandonedCartLead } from '@/lib/crm/abandoned-carts';

export const dynamic = 'force-dynamic';

export default async function AbandonedCartLeadPage({ params }) {
  const { id } = await params;
  const lead = await getAbandonedCartLead(id);
  if (!lead) notFound();
  return <AppShell>
    <header className="pageHeader">
      <div><p className="eyebrow">Abandoned-cart lead</p><h1>{lead.customer_name || 'Unknown shopper'}</h1><p className="muted">Abandoned {formatDate(lead.wix_created_at)} · {lead.currency || 'INR'} {lead.cart_value || 0}</p></div>
      <div className="toolbar"><Link className="button secondary" href="/abandoned-carts">Back to queue</Link>{lead.checkout_url ? <a className="button" href={lead.checkout_url} target="_blank">Open checkout</a> : null}</div>
    </header>
    <section className="grid orderOpsGrid">
      <article className="panel opsMain"><div className="panelHeader"><h2>Customer & cart</h2></div><div className="panelBody detailList">
        <Detail label="Phone" value={lead.phone || '-'} /><Detail label="Email" value={lead.email || '-'} /><Detail label="Abandoned" value={formatDate(lead.wix_created_at)} /><Detail label="Last cart activity" value={formatDate(lead.wix_updated_at)} />
        <Detail label="Cart value" value={`${lead.currency || 'INR'} ${lead.cart_value || 0}`} /><Detail label="Wix status" value={lead.wix_status || '-'} />
        <Detail label="Items" value={(lead.items || []).map(item => item.productName?.translated || item.productName?.original || item.productName || item.name || item.product?.name).filter(name => typeof name === 'string').join(', ') || '-'} />
      </div></article>
      <article className="panel"><div className="panelHeader"><h2>Recovery</h2></div><div className="panelBody detailList">
        <Detail label="Status" value={lead.recovered_order ? 'Recovered' : 'Not recovered'} /><Detail label="Recovered on" value={formatDate(lead.recovered_at)} />
        <Detail label="Match method" value={lead.recovery_match_method?.replaceAll('_', ' ') || '-'} />
        <Detail label="Recovered order" value={lead.recovered_order ? <Link href={`/orders/${lead.recovered_order.id}`}>{lead.recovered_order.order_number || lead.recovered_order.external_order_id || 'Open order'}</Link> : '-'} />
      </div></article>
    </section>
    <section className="panel" style={{ marginTop: 18 }}><div className="panelHeader"><h2>Operator workspace</h2></div><div className="panelBody"><AbandonedCartLeadForm lead={lead} /></div></section>
  </AppShell>;
}

function Detail({ label, value }) { return <div className="detailRow"><span>{label}</span><strong>{value}</strong></div>; }
function formatDate(value) { return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-'; }
