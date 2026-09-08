import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { ManualShipmentForm } from '@/components/manual-shipment-form';
import { OrderFilters, OrderTable } from '@/components/order-table';
import { ShipmentFilters, ShipmentList } from '@/components/shipment-list';
import { isWixFulfilled, listOrders, listShipments } from '@/lib/crm/data';

export const dynamic = 'force-dynamic';

export default async function ShipmentsPage({ searchParams }) {
  const params = await searchParams;
  const tab = params?.tab === 'all' ? 'all' : 'booking';
  const query = params?.q || ''; const status = params?.status || ''; const courier = params?.courier || '';
  const [allOrders, shipments] = await Promise.all([listOrders({ query: tab === 'booking' ? query : '', limit: 150 }), tab === 'all' ? listShipments({ query, status, courier, limit: 300 }) : Promise.resolve([])]);
  const paidOrders = allOrders.filter(order => ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status));
  const orders = paidOrders.filter(order => !['cancelled', 'not_paid', 'fulfilled_no_tracking', 'completed'].includes(order.internal_status) && !isWixFulfilled(order) && (!order.awb_number || ['packed', 'awaiting_packing', 'new'].includes(order.internal_status)));
  const metrics = tab === 'all' ? [['Shown', shipments.length], ['In transit', shipments.filter(s => ['in_transit', 'out_for_delivery', 'picked_up'].includes(s.status)).length], ['Delivered', shipments.filter(s => s.status === 'delivered').length], ['Cancelled', shipments.filter(s => ['cancelled', 'returned'].includes(s.status)).length]] : [['Book now', orders.filter(order => !order.awb_number).length], ['Wix fulfilled', paidOrders.filter(isWixFulfilled).length], ['AWB present', paidOrders.filter(order => order.awb_number).length], ['Missing contact', orders.filter(order => !order.phone || !order.pincode || !order.address_line1).length]];
  return <AppShell>
    <header className="pageHeader"><div><p className="eyebrow">Shipments</p><h1>{tab === 'all' ? 'All shipments' : 'Shipment booking'}</h1><p className="muted">{tab === 'all' ? 'Search, track, download labels, and cancel eligible Delhivery shipments.' : 'Book carrier shipments for paid orders that are ready to dispatch.'}</p></div></header>
    <nav className="pageTabs" aria-label="Shipment views"><Link href="/shipments" className={tab === 'booking' ? 'active' : ''}>Booking queue</Link><Link href="/shipments?tab=all" className={tab === 'all' ? 'active' : ''}>All shipments</Link></nav>
    <section className="grid metrics compactMetrics">{metrics.map(([label, value]) => <article className="card metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    {tab === 'all' ? <><section className="panel"><ShipmentFilters query={query} status={status} courier={courier} /><ShipmentList shipments={shipments} /></section><section className="panel"><div className="panelHeader"><h2>Add manual shipment</h2></div><div className="panelBody"><ManualShipmentForm /></div></section></> : <section className="panel"><OrderFilters query={query} action="/shipments" showStatus={false} showSource={false} /><OrderTable orders={orders} showQuickBook /></section>}
  </AppShell>;
}
