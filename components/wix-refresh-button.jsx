'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export function WixRefreshButton() {
  const router = useRouter();
  const [state, setState] = useState({ running: false, message: '' });

  async function refreshWixOrders() {
    if (state.running) return;
    setState({ running: true, message: '' });

    try {
      const response = await fetch('/api/integrations/wix/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual-refresh', force: true })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || 'Wix sync failed.');
      router.refresh();
      setState({
        running: false,
        message: result.skipped ? 'Skipped' : `Updated ${result.persisted ?? 0}`
      });
    } catch (error) {
      setState({ running: false, message: error.message || 'Refresh failed' });
    }
  }

  return (
    <div className="sidebarSync">
      <button type="button" className="secondary" onClick={refreshWixOrders} disabled={state.running}>
        <RefreshCw size={16} aria-hidden="true" />
        <span>{state.running ? 'Refreshing...' : 'Refresh Wix orders'}</span>
      </button>
      {state.message ? <span className="sidebarSyncStatus">{state.message}</span> : null}
    </div>
  );
}
