import { AppShell } from '@/components/app-shell';
import { IssueWorkspace } from '@/components/issue-workspace';
import { hasPermission } from '@/lib/access-control';
import { currentUserProfile } from '@/lib/current-user';
import { listOrders } from '@/lib/crm/data';
import { listActiveIssueUsers, listIssues } from '@/lib/crm/issues';
import { filterIssues, isIssueOverdue, ISSUE_CATEGORIES, ISSUE_PRIORITIES, ISSUE_STATUSES } from '@/lib/crm/issue-model';

export default async function IssuesPage({ searchParams }) {
  const filters = await searchParams || {};
  const [allIssues, users, orders, profile] = await Promise.all([listIssues(), listActiveIssueUsers(), listOrders({ limit: 500 }), currentUserProfile()]);
  const normalized = { ...filters, status: filters.status === 'all' ? '' : filters.status || '' };
  let issues = filterIssues(allIssues, normalized);
  if (!filters.status) issues = issues.filter(issue => issue.status !== 'resolved');
  const unresolved = allIssues.filter(issue => issue.status !== 'resolved');
  const metrics = [
    ['Open', unresolved.length, 'All unresolved tickets'],
    ['Overdue', unresolved.filter(issue => isIssueOverdue(issue)).length, 'Past target resolution'],
    ['Blocked', unresolved.filter(issue => issue.status === 'blocked').length, 'Waiting on action'],
    ['Unassigned', unresolved.filter(issue => !issue.assigned_user_id).length, 'Needs an owner']
  ];
  return <AppShell>
    <header className="pageHeader"><div><p className="eyebrow">Order operations</p><h1>Issue tracker</h1><p className="muted">Own, resolve, and audit order-specific problems.</p></div><IssueWorkspace issues={[]} users={users} orders={orders} canEdit={hasPermission(profile, 'issues.edit')} hideList /></header>
    <section className="grid metrics compactMetrics">{metrics.map(([title, value, hint]) => <article className="card metric" key={title}><span>{title}</span><strong>{value}</strong><small>{hint}</small></article>)}</section>
    <section className="panel"><form className="filters issueFilters" action="/issues"><input name="q" defaultValue={filters.q || ''} placeholder="Search issue, order, customer, or owner" /><Filter name="status" value={filters.status || ''} empty="Open issues" options={[...ISSUE_STATUSES, 'all']} /><Filter name="priority" value={filters.priority || ''} empty="All priorities" options={ISSUE_PRIORITIES} /><Filter name="category" value={filters.category || ''} empty="All categories" options={ISSUE_CATEGORIES} /><label><span className="srOnly">Owner</span><select name="assignee" defaultValue={filters.assignee || ''}><option value="">All owners</option><option value="unassigned">Unassigned</option>{users.map(user => <option value={user.id} key={user.id}>{user.full_name || user.email}</option>)}</select></label><Filter name="overdue" value={filters.overdue || ''} empty="Any target state" options={['overdue', 'on_track', 'no_target']} /><button>Apply</button><a href="/issues" className="button secondary">Clear</a></form><IssueWorkspace issues={issues} users={users} orders={orders.map(order => ({ id: order.id, order_number: order.order_number, customer_name: order.customer_name }))} canEdit={hasPermission(profile, 'issues.edit')} showCreate={false} /></section>
  </AppShell>;
}

function Filter({ name, value, empty, options }) { return <label><span className="srOnly">{empty}</span><select name={name} defaultValue={value}><option value="">{empty}</option>{options.map(option => <option value={option} key={option}>{option.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase())}</option>)}</select></label>; }
