import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { listAbandonedCartLeads } from '@/lib/crm/abandoned-carts';
import { SyncCarts } from '@/components/sync-carts';

export const dynamic = 'force-dynamic';

export default async function AbandonedCartsPage({ searchParams }) {
  const filters = await searchParams;
  const allLeads = await listAbandonedCartLeads();
  const leads = filterLeads(allLeads, filters || {});
  const dueLeads = allLeads.filter(lead => isDue(lead));
  return <AppShell>
    <header className="pageHeader"><div><p className="eyebrow">Lead management</p><h1>Abandoned carts</h1><p className="muted">A shared recovery queue for Wix shoppers.</p></div><SyncCarts /></header>
    {dueLeads.length ? <Link className="followUpAlert" href="/abandoned-carts?due=due"><strong>{dueLeads.length} follow-up{dueLeads.length === 1 ? '' : 's'} due</strong><span>Open the due queue →</span></Link> : null}
    <section className="panel"><div className="panelBody"><form className="leadFilters" action="/abandoned-carts">
      <input name="q" defaultValue={filters?.q || ''} placeholder="Search name, email, phone, or cart item" />
      <select name="stage" defaultValue={filters?.stage || ''}><option value="">All lead stages</option><option value="new">New</option><option value="contacted">Contacted</option><option value="follow_up">Follow-up</option><option value="not_interested">Not interested</option><option value="closed">Closed</option></select>
      <select name="recovery" defaultValue={filters?.recovery || ''}><option value="">All recovery states</option><option value="recovered">Recovered</option><option value="open">Not recovered</option></select>
      <select name="due" defaultValue={filters?.due || ''}><option value="">All follow-ups</option><option value="due">Follow-up due</option><option value="scheduled">Follow-up scheduled</option></select>
      <button className="secondary">Filter</button><Link className="button secondary" href="/abandoned-carts">Clear</Link>
    </form></div></section>
    <section className="panel" style={{ marginTop: 18 }}><div className="panelHeader"><h2>{leads.length} lead{leads.length === 1 ? '' : 's'}</h2></div><div className="tableWrap"><table className="leadQueue"><thead><tr><th>Customer</th><th>Cart</th><th>Lead stage</th><th>Abandoned</th><th>Cart updated</th><th>Last contact</th><th>Next follow-up</th><th>Recovery</th></tr></thead><tbody>
      {leads.map(lead => <tr key={lead.id}><td><Link href={`/abandoned-carts/${lead.id}`}><strong>{lead.customer_name || 'Unknown shopper'}</strong></Link><span className="subtle">{lead.phone || '-'}<br />{lead.email || '-'}</span></td><td><strong>{lead.currency || 'INR'} {lead.cart_value || 0}</strong><span className="subtle">{itemNames(lead.items) || '-'}</span></td><td><span className="pill neutral">{label(lead.lead_status || 'new')}</span></td><td>{formatDate(lead.wix_created_at)}</td><td>{formatDate(lead.wix_updated_at)}</td><td>{formatDate(lead.last_contacted_at)}</td><td>{formatDate(lead.next_follow_up_at)}</td><td>{lead.recovered_order_id ? <><span className="pill ok">Recovered</span><span className="subtle">{formatDate(lead.recovered_at)}</span></> : <span className="pill neutral">Open</span>}</td></tr>)}
      {!leads.length ? <tr><td colSpan="8" className="empty">No leads match these filters.</td></tr> : null}
    </tbody></table></div></section>
  </AppShell>;
}

function filterLeads(leads, filters) {
  const q = String(filters.q || '').trim().toLowerCase();
  const now = Date.now();
  return leads.filter(lead => {
    const text = [lead.customer_name, lead.email, lead.phone, itemNames(lead.items)].join(' ').toLowerCase();
    const recovered = Boolean(lead.recovered_order_id);
    const followUpAt = lead.next_follow_up_at ? Date.parse(lead.next_follow_up_at) : NaN;
    return (!q || text.includes(q))
      && (!filters.stage || lead.lead_status === filters.stage)
      && (!filters.recovery || (filters.recovery === 'recovered' ? recovered : !recovered))
      && (!filters.due || (filters.due === 'due' ? Number.isFinite(followUpAt) && followUpAt <= now : Number.isFinite(followUpAt) && followUpAt > now));
  });
}
function isDue(lead) { return !lead.recovered_order_id && lead.next_follow_up_at && Date.parse(lead.next_follow_up_at) <= Date.now(); }
function itemNames(items) { return (items || []).map(item => item.productName?.translated || item.productName?.original || item.productName || item.name || item.product?.name).filter(name => typeof name === 'string').slice(0, 2).join(', '); }
function label(value) { return String(value).replaceAll('_', ' '); }
function formatDate(value) { return value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-'; }
