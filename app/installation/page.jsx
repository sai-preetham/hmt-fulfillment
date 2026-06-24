import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { listOrders } from '@/lib/crm/data';

export default async function InstallationPage() {
  const orders = (await listOrders({ limit: 150 })).filter(order => {
    const paid = ['PAID', 'APPROVED', 'paid', 'approved'].includes(order.payment_status);
    return paid && (
      ['installation_pending', 'issue_reported', 'warranty_case', 'fulfilled_no_tracking'].includes(order.internal_status) ||
      order.shipment_status === 'delivered'
    );
  });
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Installation</p>
          <h1>Installation follow-up</h1>
          <p className="muted">Delivered orders, store/pickup fulfillments without tracking, guide/video follow-up, completed installs, and issue escalation.</p>
        </div>
      </header>
      <section className="panel"><OrderTable orders={orders} /></section>
    </AppShell>
  );
}
