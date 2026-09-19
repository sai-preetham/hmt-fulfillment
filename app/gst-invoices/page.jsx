import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { listGstInvoiceRows, summarizeGstInvoices } from '@/lib/crm/gst-invoice-export';

export const dynamic = 'force-dynamic';

export default async function GstInvoicesPage({ searchParams }) {
  const params = await searchParams;
  const defaults = defaultRange();
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(params?.start || '') ? params.start : defaults.startDate;
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(params?.end || '') ? params.end : defaults.endDate;
  let rows = [];
  let error = '';
  try { rows = await listGstInvoiceRows({ startDate, endDate }); }
  catch (cause) { error = cause.message || 'Could not load the report.'; }
  const report = summarizeGstInvoices(rows);
  const csvHref = `/api/crm/gst-invoices?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;

  return <AppShell>
    <header className="pageHeader"><div><p className="eyebrow">Reports</p><h1>Sales and GST reports</h1><p className="muted">Select a date range to prepare GST filing data and reconcile taxable value, GST, and total order value.</p></div></header>
    <section className="panel"><div className="panelBody">
      <form className="filters" action="/gst-invoices">
        <label><span>Start date</span><input name="start" type="date" defaultValue={startDate} required /></label>
        <label><span>End date</span><input name="end" type="date" defaultValue={endDate} required /></label>
        <label><span>&nbsp;</span><button type="submit">Generate report</button></label>
        <label><span>&nbsp;</span><a className="button secondary" href={csvHref}>Download CSV</a></label>
      </form>
      {error ? <p className="errorText">{error}</p> : <p className="muted">{report.orders} order{report.orders === 1 ? '' : 's'} from {displayDate(startDate)} to {displayDate(endDate)}. Cancelled, unpaid, and fully refunded orders are excluded.</p>}
    </div></section>

    {!error ? <>
      <section className="metricGrid reportMetrics">
        <article className="card metric"><span>Orders</span><strong>{report.orders}</strong></article>
        <article className="card metric"><span>Value without tax</span><strong>{currency(report.taxableValue)}</strong></article>
        <article className="card metric"><span>GST</span><strong>{currency(report.totalTax)}</strong></article>
        <article className="card metric"><span>Total sales</span><strong>{currency(report.total)}</strong></article>
        <article className="card metric"><span>Reconciliation difference</span><strong>{currency(report.difference)}</strong></article>
      </section>
      <section className="panel"><div className="panelHeader"><h2>GST treatment summary</h2></div><div className="tableWrap"><table>
        <thead><tr><th>GST treatment</th><th>Orders</th><th>Total sales</th></tr></thead>
        <tbody>{['B2B', 'B2C', 'LUT'].map(treatment => <tr key={treatment}><td><strong>{treatment}</strong></td><td>{report.treatments[treatment]?.orders || 0}</td><td>{currency(report.treatments[treatment]?.total || 0)}</td></tr>)}</tbody>
      </table></div></section>
      <section className="panel"><div className="panelHeader"><div><h2>Order-level GST data</h2><p className="muted">International orders are reported under LUT with zero GST. GSTIN appears only for valid domestic B2B orders.</p></div></div><div className="tableWrap"><table>
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Country</th><th>GSTIN</th><th>GST type</th><th>Treatment</th><th>Without tax</th><th>GST</th><th>Total</th><th>Currency</th><th>Payment</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.invoiceNumber}><td><strong>{row.invoiceNumber}</strong></td><td>{row.dateCreated}</td><td>{row.customer || '-'}</td><td>{row.deliveryCountry || '-'}</td><td>{row.gst || '-'}</td><td>{row.gstType || '-'}</td><td>{row.gstTreatment}</td><td>{currency(row.taxableValue)}</td><td>{currency(row.totalTax)}</td><td>{currency(row.total)}</td><td>{row.currency}</td><td>{row.paymentStatus}</td></tr>)}{!rows.length ? <tr><td colSpan="12" className="empty">No qualifying orders found for this date range.</td></tr> : null}</tbody>
      </table></div></section>
    </> : null}
    <Link className="subtle" href="/orders">Back to orders</Link>
  </AppShell>;
}

function defaultRange() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { startDate: `${parts.year}-${parts.month}-01`, endDate: `${parts.year}-${parts.month}-${parts.day}` };
}
function displayDate(value) { return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`)); }
function currency(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(value || 0)); }
