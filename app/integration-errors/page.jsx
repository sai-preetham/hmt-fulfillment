import { AppShell } from '@/components/app-shell';
import { StatusPill } from '@/components/status-pill';
import { listIntegrationErrors } from '@/lib/crm/data';

export default async function IntegrationErrorsPage() {
  const errors = await listIntegrationErrors();
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Errors</p>
          <h1>Integration errors</h1>
          <p className="muted">Visible failures for Wix, Amazon, courier booking, courier webhooks, duplicate detection, invalid addresses, and manual overrides.</p>
        </div>
      </header>
      <section className="panel">
        <div className="tableWrap">
          <table>
            <thead><tr><th>When</th><th>Integration</th><th>Operation</th><th>Status</th><th>Message</th></tr></thead>
            <tbody>
              {errors.map(error => (
                <tr key={error.id}>
                  <td>{new Date(error.occurred_at).toLocaleString('en-IN')}</td>
                  <td>{error.integration}</td>
                  <td>{error.operation}</td>
                  <td><StatusPill value={error.status} /></td>
                  <td>{error.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
