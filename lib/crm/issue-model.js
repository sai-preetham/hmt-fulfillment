export const ISSUE_STATUSES = ['open', 'in_progress', 'blocked', 'resolved'];
export const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const ISSUE_CATEGORIES = ['shipping', 'product', 'installation', 'payment', 'customer_support', 'other'];

export function formatIssueAge(createdAt, resolvedAt = null, now = new Date()) {
  const start = new Date(createdAt).getTime();
  const end = resolvedAt ? new Date(resolvedAt).getTime() : new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder && days < 7 ? `${days}d ${remainder}h` : `${days}d`;
}

export function isIssueOverdue(issue, now = new Date()) {
  return issue.status !== 'resolved' && Boolean(issue.target_resolution_at) && new Date(issue.target_resolution_at).getTime() < new Date(now).getTime();
}

export function filterIssues(issues, filters = {}, now = new Date()) {
  const query = String(filters.q || '').trim().toLowerCase();
  return issues.filter(issue => {
    const haystack = [issue.title, issue.description, issue.planned_resolution, issue.order_number, issue.customer_name, issue.assignee_name].join(' ').toLowerCase();
    const targetMatches = !filters.overdue
      || (filters.overdue === 'overdue' && isIssueOverdue(issue, now))
      || (filters.overdue === 'on_track' && issue.status !== 'resolved' && Boolean(issue.target_resolution_at) && !isIssueOverdue(issue, now))
      || (filters.overdue === 'no_target' && issue.status !== 'resolved' && !issue.target_resolution_at);
    return (!query || haystack.includes(query))
      && (!filters.status || issue.status === filters.status)
      && (!filters.priority || issue.priority === filters.priority)
      && (!filters.category || issue.category === filters.category)
      && (!filters.assignee || (filters.assignee === 'unassigned' ? !issue.assigned_user_id : issue.assigned_user_id === filters.assignee))
      && targetMatches;
  });
}

export async function validateIssueInput(db, input, { creating = false, current = null } = {}) {
  const value = {};
  if (creating || 'order_id' in input) {
    const orderId = String(input.order_id || '').trim();
    const { data: order } = await db.from('orders').select('id').eq('id', orderId).maybeSingle();
    if (!order) return failure('Select a valid order.');
    value.order_id = orderId;
  }
  for (const field of ['title', 'description']) {
    if (creating || field in input) {
      const text = String(input[field] || '').trim();
      const max = field === 'title' ? 160 : 5000;
      if (!text || text.length > max) return failure(`${field === 'title' ? 'Title' : 'Description'} is required and must be ${max} characters or fewer.`);
      value[field] = text;
    }
  }
  if (creating || 'category' in input) {
    if (!ISSUE_CATEGORIES.includes(input.category)) return failure('Select a valid issue category.');
    value.category = input.category;
  }
  if (creating || 'priority' in input) {
    const priority = input.priority || 'medium';
    if (!ISSUE_PRIORITIES.includes(priority)) return failure('Select a valid priority.');
    value.priority = priority;
  }
  if ('status' in input) {
    if (!ISSUE_STATUSES.includes(input.status)) return failure('Select a valid status.');
    value.status = input.status;
  }
  if (creating || 'assigned_user_id' in input) {
    const assignee = String(input.assigned_user_id || '').trim() || null;
    if (assignee) {
      const { data: user } = await db.from('users').select('id').eq('id', assignee).eq('active', true).maybeSingle();
      if (!user) return failure('The selected assignee is not an active user.');
    }
    value.assigned_user_id = assignee;
  }
  for (const field of ['planned_resolution', 'final_resolution']) {
    if (field in input || (creating && field === 'planned_resolution')) {
      const text = String(input[field] || '').trim();
      if (text.length > 5000) return failure(`${field === 'planned_resolution' ? 'Planned' : 'Final'} resolution must be 5000 characters or fewer.`);
      value[field] = text || null;
    }
  }
  if (creating || 'target_resolution_at' in input) {
    const raw = String(input.target_resolution_at || '').trim();
    if (raw && !Number.isFinite(new Date(raw).getTime())) return failure('Enter a valid target resolution date.');
    value.target_resolution_at = raw ? new Date(raw).toISOString() : null;
  }
  if (current && value.order_id && value.order_id !== current.order_id) return failure('An issue cannot be moved to another order.');
  return { ok: true, value };
}

export function applyResolutionState(current, patch, actor, now = new Date()) {
  const nextStatus = patch.status ?? current.status;
  if (nextStatus !== 'resolved' && current.status !== 'resolved' && patch.final_resolution) return failure('Final resolution can only be recorded when the issue is resolved.');
  if (nextStatus === 'resolved') {
    const resolution = String(patch.final_resolution ?? current.final_resolution ?? '').trim();
    if (!resolution) return failure('Final resolution is required before resolving an issue.');
    return { ok: true, value: { final_resolution: resolution, resolved_by: current.status === 'resolved' ? current.resolved_by : actor.id, resolved_at: current.status === 'resolved' ? current.resolved_at : new Date(now).toISOString() } };
  }
  if (current.status === 'resolved' || patch.status) return { ok: true, value: { final_resolution: null, resolved_by: null, resolved_at: null } };
  return { ok: true, value: {} };
}

function failure(error, status = 400) { return { ok: false, error, status }; }
