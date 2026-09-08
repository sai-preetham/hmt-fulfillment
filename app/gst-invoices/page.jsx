import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { listGstInvoiceRows } from '@/lib/crm/gst-invoice-export';

export const dynamic = 'force-dynamic';

export default async function GstInvoicesPage({ searchParams }) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params?.month || '') ? params.month : new Date().toISOString().slice(0, 7);
  const rows = await listGstInvoiceRows(month);
  const csvHref = `/api/crm/gst-invoices?month=${encodeURIComponent(month)}`;

  return <AppShell>
    <header className="pageHeader">
      <div>
        <p className="eyebrow">GST</p>
        <h1>Monthly invoice export</h1>
        <p className="muted">Domestic totals retain 18% GST. International orders are marked as zero-rated exports under LUT.</p>
      </div>
    </header>
    <section className="panel">
      <div className="panelBody">
        <form className="filters" action="/gst-invoices">
          <label><span>Invoice month</span><input name="month" type="month" defaultValue={month} /></label>
          <label><span>&nbsp;</span><button type="submit">View invoices</button></label>
          <label><span>&nbsp;</span><a className="button" href={csvHref}>Download CSV</a></label>
        </form>
        <p className="muted">{rows.length} invoice{rows.length === 1 ? '' : 's'} shown. The GST column is populated only for domestic B2B orders with a valid GSTIN.</p>
      </div>
      <div className="tableWrap"><table>
        <thead><tr><th>Invoice</th><th>Date</th><th>GSTIN</th><th>Delivery</th><th>Billing</th><th>Tax</th><th>Total</th><th>Currency</th><th>GST treatment</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.invoiceNumber}>
          <td><strong>{row.invoiceNumber}</strong></td><td>{row.dateCreated}</td><td>{row.gst || '-'}</td><td>{row.deliveryCountry || '-'}</td><td>{row.billingCountry || '-'}</td><td>{row.totalTax.toFixed(2)}</td><td>{row.total.toFixed(2)}</td><td>{row.currency}</td><td>{row.gstTreatment}</td>
        </tr>)}{!rows.length ? <tr><td colSpan="9" className="empty">No invoices found for this month.</td></tr> : null}</tbody>
      </table></div>
    </section>
    <Link className="subtle" href="/orders">Back to orders</Link>
  </AppShell>;
}
