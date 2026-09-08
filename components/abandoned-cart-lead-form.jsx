'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STAGES = [['new', 'New'], ['contacted', 'Contacted'], ['follow_up', 'Follow-up'], ['not_interested', 'Not interested'], ['closed', 'Closed']];

export function AbandonedCartLeadForm({ lead }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/crm/abandoned-carts/${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(form))
    });
    const result = await response.json();
    setSaving(false);
    if (!result.ok) return setMessage(result.error || 'Unable to save this lead.');
    setMessage('Saved.');
    router.refresh();
  }

  return <form className="leadForm" onSubmit={save}>
    <label><span>Lead stage</span><select name="lead_status" defaultValue={lead.lead_status || 'new'}>{STAGES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label><span>Call outcome</span><input name="call_outcome" defaultValue={lead.call_outcome || ''} placeholder="e.g. No answer, wants a callback" /></label>
    <label><span>Last contacted</span><input name="last_contacted_at" type="datetime-local" defaultValue={localInputValue(lead.last_contacted_at)} /></label>
    <label><span>Next follow-up</span><input name="next_follow_up_at" type="datetime-local" defaultValue={localInputValue(lead.next_follow_up_at)} /></label>
    <label className="full"><span>Notes</span><textarea name="notes" defaultValue={lead.notes || ''} placeholder="Call notes, objections, or next steps" /></label>
    <div className="toolbar"><button disabled={saving}>{saving ? 'Saving…' : 'Save lead'}</button>{message ? <small className="muted">{message}</small> : null}</div>
  </form>;
}

function localInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
