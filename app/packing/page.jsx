import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function PackingPage() {
  const orders = (await listOrders({ status: 'awaiting_packing', limit: 150 }))
    .filter(order => ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status));
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Packing</p>
          <h1>Daily packing queue</h1>
          <p className="muted">Tablet-friendly checklist flow for parts, photos, package weight, dimensions, and pickup readiness.</p>
        </div>
      </header>
      <section className="panel"><OrderTable orders={orders} /></section>
    </AppShell>
  );
}
