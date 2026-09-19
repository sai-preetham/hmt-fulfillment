'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { CircleAlert, Plus, X } from 'lucide-react';
import { StatusPill } from './status-pill';
import { formatIssueAge, isIssueOverdue, ISSUE_CATEGORIES, ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/crm/issue-model';

export function IssueWorkspace({ issues: initialIssues = [], users = [], orders = [], canEdit = false, orderId = '', compact = false, hideList = false, showCreate = true }) {
  const [issues, setIssues] = useState(initialIssues);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const createRef = useRef(null);
  const detailRef = useRef(null);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const response = await fetch('/api/crm/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error || 'Issue could not be created.');
    setIssues(sortIssues([...issues, data.issue]));
    event.currentTarget.reset();
    createRef.current?.close();
    window.location.reload();
  }

  async function openIssue(id) {
    setMessage('');
    const response = await fetch(`/api/crm/issues/${id}`);
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || 'Issue could not be opened.');
    setSelected(data.issue);
    detailRef.current?.showModal();
  }

  async function update(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const response = await fetch(`/api/crm/issues/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error || 'Issue could not be updated.');
    replaceIssue(data.issue);
    setSelected(data.issue);
    setMessage('Changes saved.');
  }

  async function comment(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const response = await fetch(`/api/crm/issues/${selected.id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(data.error || 'Comment could not be added.');
    replaceIssue(data.issue);
    setSelected(data.issue);
    event.currentTarget.reset();
  }

  function replaceIssue(issue) { setIssues(current => sortIssues(current.map(item => item.id === issue.id ? issue : item))); }
  const visible = compact ? sortIssues(issues) : issues;

  return (
    <>
      {canEdit && showCreate ? <button type="button" onClick={() => createRef.current?.showModal()}><Plus size={16} /> New issue</button> : null}
      {!hideList ? (compact ? <IssueCards issues={visible} onOpen={openIssue} /> : <IssueTable issues={visible} onOpen={openIssue} />) : null}

      <dialog className="editDialog issueDialog" ref={createRef} onClose={() => setMessage('')}>
        <DialogHeader eyebrow="Order issue" title="Create issue" onClose={() => createRef.current?.close()} />
        <form className="formGrid editDialogForm" onSubmit={create}>
          {orderId ? <input type="hidden" name="order_id" value={orderId} /> : <label className="full"><span>Order</span><select name="order_id" required defaultValue=""><option value="">Select an order</option>{orders.map(order => <option value={order.id} key={order.id}>{order.order_number || order.id} · {order.customer_name || 'Customer not set'}</option>)}</select></label>}
          <Field name="title" label="Issue" required maxLength="160" />
          <Select name="category" label="Category" options={ISSUE_CATEGORIES} />
          <Select name="priority" label="Priority" options={ISSUE_PRIORITIES} defaultValue="medium" />
          <Assignee users={users} />
          <label className="full"><span>Description</span><textarea name="description" required maxLength="5000" /></label>
          <label className="full"><span>Planned resolution</span><textarea name="planned_resolution" maxLength="5000" placeholder="What should be done to resolve this issue?" /></label>
          <Field name="target_resolution_at" label="Target resolution" type="datetime-local" />
          <Actions busy={busy} message={message} onCancel={() => createRef.current?.close()} submit="Create issue" />
        </form>
      </dialog>

      <dialog className="editDialog issueDialog" ref={detailRef} onClose={() => setMessage('')}>
        {selected ? <>
          <DialogHeader eyebrow={`Order ${selected.order_number || ''}`} title={selected.title} onClose={() => detailRef.current?.close()} />
          <div className="issueDialogBody">
            <div className="toolbar"><StatusPill value={selected.priority} /><StatusPill value={selected.status} />{isIssueOverdue(selected) ? <span className="pill danger">Overdue</span> : null}<span className="pill neutral">{formatIssueAge(selected.created_at, selected.resolved_at)} {selected.resolved_at ? 'to resolve' : 'open'}</span><Link href={`/orders/${selected.order_id}`} className="button secondary">Open order</Link></div>
            {canEdit ? <form className="formGrid" onSubmit={update}>
              <Field name="title" label="Issue" defaultValue={selected.title} required maxLength="160" />
              <Select name="status" label="Status" options={ISSUE_STATUSES} defaultValue={selected.status} />
              <Select name="category" label="Category" options={ISSUE_CATEGORIES} defaultValue={selected.category} />
              <Select name="priority" label="Priority" options={ISSUE_PRIORITIES} defaultValue={selected.priority} />
              <Assignee users={users} defaultValue={selected.assigned_user_id} />
              <Field name="target_resolution_at" label="Target resolution" type="datetime-local" defaultValue={toLocalInput(selected.target_resolution_at)} />
              <label className="full"><span>Description</span><textarea name="description" defaultValue={selected.description} required maxLength="5000" /></label>
              <label className="full"><span>Planned resolution</span><textarea name="planned_resolution" defaultValue={selected.planned_resolution || ''} maxLength="5000" /></label>
              <label className="full"><span>Final resolution (required when resolving)</span><textarea name="final_resolution" defaultValue={selected.final_resolution || ''} maxLength="5000" /></label>
              <Actions busy={busy} message={message} submit="Save changes" />
            </form> : <ReadOnlyIssue issue={selected} />}
            <section className="issueActivity">
              <h3>Comments</h3>
              {canEdit ? <form className="commentForm" onSubmit={comment}><textarea name="body" placeholder="Add an internal comment" required maxLength="5000" /><button disabled={busy}>Add comment</button></form> : null}
              <div className="timeline">{selected.comments?.length ? selected.comments.map(item => <div className="timelineItem" key={item.id}><strong>{item.author?.full_name || item.author?.email || 'Operator'}</strong><small>{formatDateTime(item.created_at)}</small><p>{item.body}</p></div>) : <p className="muted">No comments yet.</p>}</div>
              <details><summary>Change history</summary><div className="timeline issueHistory">{selected.history?.map(item => <div className="timelineItem" key={item.id}><strong>{label(item.field_name)}</strong><small>{formatDateTime(item.created_at)} · {item.actor?.full_name || item.actor?.email || 'Operator'}</small><p className="muted">{historyText(item)}</p></div>)}</div></details>
            </section>
          </div>
        </> : null}
      </dialog>
    </>
  );
}

function IssueTable({ issues, onOpen }) {
  return <div className="tableWrap"><table className="issueTable"><thead><tr><th>Issue</th><th>Order / customer</th><th>Priority</th><th>Status</th><th>Owner</th><th>Planned resolution</th><th>Time open</th><th>Target</th></tr></thead><tbody>{issues.map(issue => <tr key={issue.id} className={isIssueOverdue(issue) ? 'overdueRow' : ''} onClick={() => onOpen(issue.id)} tabIndex="0" onKeyDown={event => { if (event.key === 'Enter') onOpen(issue.id); }}><td><strong>{issue.title}</strong><span className="subtle">{label(issue.category)}</span></td><td><Link href={`/orders/${issue.order_id}`} onClick={event => event.stopPropagation()}><strong>{issue.order_number || 'Open order'}</strong></Link><span className="subtle">{issue.customer_name || 'Customer not set'}</span></td><td><StatusPill value={issue.priority} /></td><td><StatusPill value={issue.status} /></td><td className={!issue.assigned_user_id ? 'dangerText' : ''}>{issue.assignee_name || 'Unassigned'}</td><td className={!issue.planned_resolution ? 'dangerText' : ''}>{issue.planned_resolution || 'Not defined'}</td><td>{formatIssueAge(issue.created_at, issue.resolved_at)}</td><td className={isIssueOverdue(issue) || (!issue.target_resolution_at && issue.status !== 'resolved') ? 'dangerText' : ''}>{issue.target_resolution_at ? formatDateTime(issue.target_resolution_at) : 'No target'}</td></tr>)}{!issues.length ? <tr><td colSpan="8" className="empty">No issues match this view.</td></tr> : null}</tbody></table></div>;
}

function IssueCards({ issues, onOpen }) {
  return <div className="issueCards">{issues.length ? issues.map(issue => <button type="button" className={`issueCard ${isIssueOverdue(issue) ? 'overdue' : ''}`} key={issue.id} onClick={() => onOpen(issue.id)}><span><strong>{issue.title}</strong><small>{issue.assignee_name || 'Unassigned'} · {formatIssueAge(issue.created_at, issue.resolved_at)} {issue.resolved_at ? 'to resolve' : 'open'}</small></span><span className="toolbar"><StatusPill value={issue.priority} /><StatusPill value={issue.status} /></span><span className="issuePlan">{issue.planned_resolution || 'Planned resolution not defined'}</span></button>) : <p className="muted">No issues have been recorded for this order.</p>}</div>;
}

function ReadOnlyIssue({ issue }) { return <div className="detailList"><Detail label="Description" value={issue.description} /><Detail label="Owner" value={issue.assignee_name || 'Unassigned'} /><Detail label="Planned resolution" value={issue.planned_resolution || 'Not defined'} /><Detail label="Final resolution" value={issue.final_resolution || 'Not resolved'} /></div>; }
function Detail({ label: title, value }) { return <div className="detailRow"><span>{title}</span><strong>{value}</strong></div>; }
function DialogHeader({ eyebrow, title, onClose }) { return <div className="editDialogHeader"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="iconButton" type="button" aria-label="Close" onClick={onClose}><X size={18} /></button></div>; }
function Field(props) { const { label: title, ...input } = props; return <label><span>{title}</span><input {...input} /></label>; }
function Select({ name, label: title, options, defaultValue }) { return <label><span>{title}</span><select name={name} defaultValue={defaultValue || options[0]}>{options.map(option => <option value={option} key={option}>{label(option)}</option>)}</select></label>; }
function Assignee({ users, defaultValue = '' }) { return <label><span>Owner</span><select name="assigned_user_id" defaultValue={defaultValue || ''}><option value="">Unassigned</option>{users.map(user => <option value={user.id} key={user.id}>{user.full_name || user.email}</option>)}</select></label>; }
function Actions({ busy, message, onCancel, submit }) { return <div className="toolbar full editDialogActions">{onCancel ? <button type="button" className="secondary" onClick={onCancel}>Cancel</button> : null}<button disabled={busy}>{busy ? 'Saving…' : submit}</button>{message ? <span className="muted full">{message}</span> : null}</div>; }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()); }
function historyText(item) { if (item.field_name === 'created') return `Created “${item.new_value}”.`; return `${item.old_value || 'Not set'} → ${item.new_value || 'Not set'}`; }
function formatDateTime(value) { return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function toLocalInput(value) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function sortIssues(items) { return [...items].sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || new Date(a.created_at) - new Date(b.created_at)); }
