import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { isWixFulfilled, listOrders } from '@/lib/crm/data';

// This queue must reflect newly synced Wix orders on every navigation.
export const dynamic = 'force-dynamic';

export default async function ShipmentsPage() {
  const allOrders = await listOrders({ limit: 150 });
  const paidOrders = allOrders.filter(order => ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status));
  const orders = paidOrders.filter(order => {
    const paid = ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status);
    const active = !['cancelled', 'not_paid', 'fulfilled_no_tracking', 'completed'].includes(order.internal_status);
    return paid && active && !isWixFulfilled(order) && (!order.awb_number || ['packed', 'awaiting_packing', 'new'].includes(order.internal_status));
  });
  const metrics = [
    ['Book now', orders.filter(order => !order.awb_number).length],
    ['Wix fulfilled', paidOrders.filter(isWixFulfilled).length],
    ['AWB present', paidOrders.filter(order => order.awb_number).length],
    ['Missing contact', orders.filter(order => !order.phone || !order.pincode || !order.address_line1).length]
  ];

  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Shipments</p>
          <h1>Shipment booking</h1>
        </div>
      </header>
      <section className="grid metrics compactMetrics">
        {metrics.map(([label, value]) => (
          <article className="card metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="panel"><OrderTable orders={orders} /></section>
    </AppShell>
  );
}
