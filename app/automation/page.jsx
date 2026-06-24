import { AppShell } from '@/components/app-shell';
import { AutomationActions } from '@/components/automation-actions';
import { StatusPill } from '@/components/status-pill';
import { getAutomationDashboardData } from '@/lib/crm/automation';

export const dynamic = 'force-dynamic';

export default async function AutomationPage() {
  const data = await getAutomationDashboardData();
  const queues = data.queues || {};
  const queueCards = [
    ['Ready to book', queues.readyToBook || 0],
    ['Blocked validation', queues.blockedValidation || 0],
    ['FedEx CSV pending', queues.fedexPending || 0],
    ['Awaiting FedEx AWB', queues.awaitingFedexAwb || 0],
    ['Wix failed', queues.wixFailed || 0],
    ['Chatwoot failed', queues.chatwootFailed || 0],
    ['Courier failed', queues.courierFailed || 0],
    ['Active tracking', queues.activeTracking || 0],
    ['Manual holds', queues.manualHolds || 0]
  ];
  const lastRun = data.lastRun;
  const counters = lastRun?.counters || data.state?.lastResult?.counters || {};

  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Automation</p>
          <h1>Shipment automation control tower</h1>
          <p className="muted">Local Raspberry Pi cron should call the protected run API every 15 minutes.</p>
        </div>
        <div className="toolbar">
          <StatusPill value={lastRun?.status || data.state?.lastResult?.status || 'not_run'} />
        </div>
      </header>

      {!data.ok ? (
        <section className="panel">
          <div className="panelBody"><span className="pill danger">{data.error}</span></div>
        </section>
      ) : null}

      <section className="grid metrics">
        <article className="card metric"><span>Last run</span><strong>{lastRun?.started_at ? new Date(lastRun.started_at).toLocaleTimeString('en-IN') : '-'}</strong><small>{lastRun?.trigger || 'Waiting'}</small></article>
        <article className="card metric"><span>Next expected</span><strong>{data.nextRunHint ? new Date(data.nextRunHint).toLocaleTimeString('en-IN') : '-'}</strong><small>15 minute timer</small></article>
        <article className="card metric"><span>Booked</span><strong>{counters.booked || 0}</strong><small>{counters.queued || 0} queued</small></article>
        <article className="card metric"><span>Updated</span><strong>{counters.wixUpdated || 0} / {counters.messagesSent || 0}</strong><small>Wix / Chatwoot</small></article>
      </section>

      <section className="grid threeCol" style={{ marginTop: 14 }}>
        {queueCards.map(([label, value]) => (
          <article className="card metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="grid twoCol" style={{ marginTop: 14 }}>
        <AutomationActions batches={data.fedexBatches || []} />
        <section className="panel">
          <div className="panelHeader"><h2>Recent runs</h2></div>
          <div className="panelBody grid">
            {(data.runs || []).map(run => (
              <div className="taskCard" key={run.id}>
                <strong>{run.trigger}</strong>
                <span className="subtle">{run.started_at ? new Date(run.started_at).toLocaleString('en-IN') : ''}</span>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  <StatusPill value={run.status} />
                  <span className="muted">{run.counters?.processed || 0} processed</span>
                </div>
                {run.error_summary ? <p className="muted" style={{ marginTop: 8 }}>{run.error_summary}</p> : null}
              </div>
            ))}
            {!(data.runs || []).length ? <p className="muted">No automation runs recorded yet.</p> : null}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panelHeader"><h2>Open automation errors</h2></div>
        <div className="panelBody grid">
          {(data.errors || []).map(error => (
            <div className="taskCard" key={error.id}>
              <strong>{error.integration} · {error.operation}</strong>
              <span className="subtle">{error.occurred_at ? new Date(error.occurred_at).toLocaleString('en-IN') : ''}</span>
              <p className="muted">{error.message}</p>
            </div>
          ))}
          {!(data.errors || []).length ? <p className="muted">No open integration errors.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}
