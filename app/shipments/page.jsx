import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function ShipmentsPage() {
  const orders = (await listOrders({ limit: 150 })).filter(order => {
    const paid = ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status);
    const active = !['cancelled', 'not_paid', 'fulfilled_no_tracking', 'completed'].includes(order.internal_status);
    return paid && active && (!order.awb_number || ['packed', 'awaiting_packing', 'new'].includes(order.internal_status));
  });
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Shipments</p>
          <h1>Shipment booking</h1>
          <p className="muted">Book Delhivery, FedEx, or Shree Maruti shipments, validate missing fields, store AWB, tracking URL, label, invoice, and courier response.</p>
        </div>
      </header>
      <section className="panel"><OrderTable orders={orders} /></section>
    </AppShell>
  );
}
