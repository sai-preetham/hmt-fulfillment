import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function PickupPage() {
  const orders = await listOrders({ status: 'pickup_pending', limit: 100 });
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Pickup</p>
          <h1>Pickup pending</h1>
          <p className="muted">Track booked shipments that still need pickup, failed pickup follow-up, and ready-for-pickup overrides.</p>
        </div>
      </header>
      <section className="panel"><OrderTable orders={orders} /></section>
    </AppShell>
  );
}
