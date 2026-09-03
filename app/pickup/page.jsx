import { AppShell } from '@/components/app-shell';
import { OrderFilters, OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function PickupPage({ searchParams }) {
  const query = (await searchParams)?.q || '';
  const orders = await listOrders({ query, status: 'pickup_pending', limit: 100 });
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Pickup</p>
          <h1>Pickup pending</h1>
          <p className="muted">Track booked shipments that still need pickup, failed pickup follow-up, and ready-for-pickup overrides.</p>
        </div>
      </header>
      <section className="panel">
        <OrderFilters query={query} action="/pickup" showStatus={false} showSource={false} />
        <OrderTable orders={orders} />
      </section>
    </AppShell>
  );
}
