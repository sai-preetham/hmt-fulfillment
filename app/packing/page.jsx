import { AppShell } from '@/components/app-shell';
import { OrderFilters, OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function PackingPage({ searchParams }) {
  const query = (await searchParams)?.q || '';
  const orders = (await listOrders({ query, status: 'awaiting_packing', limit: 150 }))
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
      <section className="panel">
        <OrderFilters query={query} action="/packing" showStatus={false} showSource={false} />
        <OrderTable orders={orders} />
      </section>
    </AppShell>
  );
}
