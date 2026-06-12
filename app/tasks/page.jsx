import { AppShell } from '@/components/app-shell';
import { StatusPill } from '@/components/status-pill';
import { listTasks } from '@/lib/crm/data';

export default async function TasksPage() {
  const tasks = await listTasks();
  const columns = ['open', 'in_progress', 'blocked', 'done'];
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Operator task board</h1>
          <p className="muted">Auto-created work for order verification, packing, booking, pickup issues, delivery checks, installation, feedback, reviews, and support.</p>
        </div>
      </header>
      <section className="kanban">
        {columns.map(column => (
          <div className="column" key={column}>
            <h2>{column.replaceAll('_', ' ')}</h2>
            {tasks.filter(task => task.status === column).map(task => (
              <article className="taskCard" key={task.id}>
                <strong>{task.title}</strong>
                <span className="subtle">Order {task.order_number || task.order_id}</span>
                <span className="subtle">Due {task.due_date ? new Date(task.due_date).toLocaleDateString('en-IN') : 'not set'} · {task.assigned_operator || 'Unassigned'}</span>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <StatusPill value={task.priority} />
                  <StatusPill value={task.status} />
                </div>
                <p className="muted" style={{ marginTop: 8 }}>{task.notes}</p>
              </article>
            ))}
          </div>
        ))}
      </section>
    </AppShell>
  );
}
