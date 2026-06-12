import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { OrderTable } from '@/components/order-table';
import { StatusPill } from '@/components/status-pill';
import { getDashboardSummary, listOrders, listTasks } from '@/lib/crm/data';

export default async function DashboardPage() {
  const [summary, orders, tasks] = await Promise.all([
    getDashboardSummary(),
    listOrders({ limit: 8 }),
    listTasks()
  ]);

  const metrics = [
    ['New orders', summary.newOrders],
    ['Orders to pack', summary.ordersToPack],
    ['Shipments to book', summary.shipmentsToBook],
    ['Pickup pending', summary.pickupPending],
    ['Delivered today', summary.deliveredToday],
    ['Installation follow-ups due', summary.installationDue],
    ['Feedback calls due', summary.feedbackDue],
    ['Open issues', summary.openIssues]
  ];

  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Today</p>
          <h1>Operations command center</h1>
          <p className="muted">A working queue for fulfillment, packing, courier tracking, installation follow-up, feedback, and support.</p>
        </div>
        <div className="toolbar">
          <Link className="button secondary" href="/orders">Search orders</Link>
          <Link className="button" href="/shipments">Book shipment</Link>
        </div>
      </header>

      <section className="grid metrics">
        {metrics.map(([label, value]) => (
          <article className="card metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="grid threeCol" style={{ marginTop: 14 }}>
        <article className="card metric">
          <span>Average order to shipment</span>
          <strong>{summary.avgOrderToShipmentHours}h</strong>
          <small>Target under 24h</small>
        </article>
        <article className="card metric">
          <span>Average shipment to delivery</span>
          <strong>{summary.avgShipmentToDeliveryDays}d</strong>
          <small>Courier blended average</small>
        </article>
        <article className="card metric">
          <span>Completion health</span>
          <strong>{summary.installationCompletionRate}% / {summary.feedbackCompletionRate}%</strong>
          <small>Installation / feedback</small>
        </article>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panelHeader">
          <h2>Recent orders</h2>
          <Link href="/orders" className="button secondary">View all</Link>
        </div>
        <OrderTable orders={orders} />
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>Urgent tasks</h2>
          <Link href="/tasks" className="button secondary">Task list</Link>
        </div>
        <div className="panelBody grid">
          {tasks.slice(0, 5).map(task => (
            <div className="taskCard" key={task.id}>
              <strong>{task.title}</strong>
              <span className="subtle">Order {task.order_number} · {task.assigned_operator || 'Unassigned'}</span>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <StatusPill value={task.priority} />
                <StatusPill value={task.status} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
