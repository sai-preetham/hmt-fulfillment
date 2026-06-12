import { AppShell } from '@/components/app-shell';
import { ManualOrderForm } from '@/components/manual-order-form';
import { OrderFilters, OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function OrdersPage({ searchParams }) {
  const params = await searchParams;
  const query = params?.q || '';
  const status = params?.status || '';
  const source = params?.source || '';
  const orders = await listOrders({ query, status, source, limit: 150 });

  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Orders</p>
          <h1>Order workbench</h1>
          <p className="muted">Search by customer, phone, order ID, AWB, bike model, or source.</p>
        </div>
      </header>

      <section className="panel">
        <OrderFilters query={query} status={status} source={source} />
        <OrderTable orders={orders} />
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Create manual order</h2>
        </div>
        <div className="panelBody">
          <ManualOrderForm />
        </div>
      </section>
    </AppShell>
  );
}
