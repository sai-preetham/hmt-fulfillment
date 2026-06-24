import { AppShell } from '@/components/app-shell';
import { COURIERS, ROLES } from '@/lib/crm/constants';
import { createBrowserConfig } from '@/lib/supabase/server';

export default function SettingsPage() {
  const supabase = createBrowserConfig();
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>CRM settings</h1>
          <p className="muted">Configure operators, roles, courier accounts, pickup locations, integrations, and Chatwoot references in Supabase.</p>
        </div>
      </header>
      <section className="grid threeCol">
        <article className="card metric"><span>Supabase URL</span><strong>{supabase.url ? 'Configured' : 'Missing'}</strong><small>NEXT_PUBLIC_SUPABASE_URL</small></article>
        <article className="card metric"><span>Supabase anon key</span><strong>{supabase.anonKey ? 'Configured' : 'Missing'}</strong><small>NEXT_PUBLIC_SUPABASE_ANON_KEY</small></article>
        <article className="card metric"><span>Chatwoot</span><strong>{process.env.CHATWOOT_BASE_URL ? 'Configured' : 'Ready'}</strong><small>Use external conversations</small></article>
      </section>
      <section className="grid twoCol" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panelHeader"><h2>Roles</h2></div>
          <div className="panelBody statusStack">{ROLES.map(role => <span className="pill neutral" key={role}>{role.replaceAll('_', ' ')}</span>)}</div>
        </div>
        <div className="panel">
          <div className="panelHeader"><h2>Couriers</h2></div>
          <div className="panelBody statusStack">{COURIERS.map(courier => <span className="pill neutral" key={courier}>{courier.replaceAll('_', ' ')}</span>)}</div>
        </div>
      </section>
    </AppShell>
  );
}
