'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, DownloadCloud, UploadCloud } from 'lucide-react';

export function WixOrderActions({ order }) {
  const router = useRouter();
  const [state, setState] = useState({ action: '', message: '' });

  async function runAction(action, options = {}) {
    if (state.action) return;
    setState({ action, message: '' });

    try {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body || {})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) throw new Error(result.error || 'Wix action failed.');
      router.refresh();
      setState({ action: '', message: options.success });
    } catch (error) {
      setState({ action: '', message: error.message || 'Wix action failed.' });
    }
  }

  return (
    <div className="quickActions">
      <button
        type="button"
        className="secondary"
        disabled={Boolean(state.action)}
        onClick={() => runAction('pull', {
          url: `/api/crm/orders/${order.id}/wix/pull`,
          success: 'Latest Wix order pulled.'
        })}
      >
        <DownloadCloud size={16} aria-hidden="true" />
        Pull from Wix
      </button>
      <button
        type="button"
        className="secondary"
        disabled={Boolean(state.action)}
        onClick={() => runAction('tracking', {
          url: `/api/crm/orders/${order.id}/wix/push`,
          body: { mode: 'tracking' },
          success: 'Tracking pushed to Wix.'
        })}
      >
        <UploadCloud size={16} aria-hidden="true" />
        Push tracking
      </button>
      <button
        type="button"
        disabled={Boolean(state.action)}
        onClick={() => runAction('fulfilled', {
          url: `/api/crm/orders/${order.id}/wix/push`,
          body: { mode: 'fulfilled' },
          success: 'Wix marked fulfilled.'
        })}
      >
        <CheckCircle2 size={16} aria-hidden="true" />
        Mark fulfilled
      </button>
      {state.message ? <span className="muted">{state.message}</span> : null}
    </div>
  );
}
