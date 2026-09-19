import { createServiceClient } from '@/lib/supabase/server';
import { applyResolutionState, filterIssues, validateIssueInput } from '@/lib/crm/issue-model';

const TRACKED_FIELDS = ['assigned_user_id', 'priority', 'status', 'target_resolution_at', 'planned_resolution', 'final_resolution'];
const ISSUE_SELECT = `
  *,
  orders!issues_order_id_fkey(id,order_number,customer_id,customers!orders_customer_id_fkey(name,email,phone)),
  assignee:users!issues_assigned_user_id_fkey(id,full_name,email,active),
  creator:users!issues_created_by_fkey(id,full_name,email),
  resolver:users!issues_resolved_by_fkey(id,full_name,email)
`;

export async function listActiveIssueUsers() {
  const db = createServiceClient();
  if (!db) return [];
  const { data, error } = await db.from('users').select('id,full_name,email,role,active').eq('active', true).order('full_name');
  if (error) return [];
  return data || [];
}

export async function listIssues(filters = {}) {
  const db = createServiceClient();
  if (!db) return [];
  let request = db.from('issues').select(ISSUE_SELECT).limit(500);
  if (filters.order_id) request = request.eq('order_id', filters.order_id);
  const { data, error } = await request.order('created_at', { ascending: true });
  if (error) return [];
  const issues = (data || []).map(mapIssue);
  return filterIssues(issues, filters).sort(compareIssues);
}

export async function getIssue(id) {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db.from('issues').select(ISSUE_SELECT).eq('id', id).maybeSingle();
  if (error || !data) return null;
  const [{ data: comments }, { data: history }] = await Promise.all([
    db.from('issue_comments').select('*,author:users!issue_comments_created_by_fkey(id,full_name,email)').eq('issue_id', id).order('created_at'),
    db.from('issue_history').select('*,actor:users!issue_history_actor_user_id_fkey(id,full_name,email)').eq('issue_id', id).order('created_at', { ascending: false })
  ]);
  return { ...mapIssue(data), comments: comments || [], history: history || [] };
}

export async function createIssue(input, actor) {
  const db = createServiceClient();
  if (!db) return failure('Issue storage is not configured.');
  const validated = await validateIssueInput(db, input, { creating: true });
  if (!validated.ok) return validated;
  const record = { ...validated.value, status: 'open', created_by: actor.id };
  const { data, error } = await db.from('issues').insert(record).select('id').single();
  if (error) return failure(error.message);
  const { error: historyError } = await db.from('issue_history').insert({ issue_id: data.id, field_name: 'created', new_value: record.title, actor_user_id: actor.id });
  if (historyError) {
    await db.from('issues').delete().eq('id', data.id);
    return failure(historyError.message);
  }
  return { ok: true, issue: await getIssue(data.id) };
}

export async function updateIssue(id, input, actor) {
  const db = createServiceClient();
  if (!db) return failure('Issue storage is not configured.');
  const { data: current, error } = await db.from('issues').select('*').eq('id', id).maybeSingle();
  if (error || !current) return failure('Issue not found.', 404);
  const validated = await validateIssueInput(db, input, { current });
  if (!validated.ok) return validated;
  const patch = { ...validated.value, updated_at: new Date().toISOString() };
  const resolutionState = applyResolutionState(current, patch, actor);
  if (!resolutionState.ok) return resolutionState;
  Object.assign(patch, resolutionState.value);
  const changes = TRACKED_FIELDS.filter(field => field in patch && comparable(current[field]) !== comparable(patch[field]));
  const { error: updateError } = await db.from('issues').update(patch).eq('id', id);
  if (updateError) return failure(updateError.message);
  if (changes.length) {
    const rows = changes.map(field => ({ issue_id: id, field_name: field, old_value: comparable(current[field]), new_value: comparable(patch[field]), actor_user_id: actor.id }));
    const { error: historyError } = await db.from('issue_history').insert(rows);
    if (historyError) {
      const rollback = Object.fromEntries(Object.keys(patch).map(field => [field, current[field]]));
      await db.from('issues').update(rollback).eq('id', id);
      return failure(`Issue change was rolled back because history could not be recorded: ${historyError.message}`, 500);
    }
  }
  return { ok: true, issue: await getIssue(id) };
}

export async function addIssueComment(id, body, actor) {
  const db = createServiceClient();
  if (!db) return failure('Issue storage is not configured.');
  const text = String(body || '').trim();
  if (!text || text.length > 5000) return failure('Comment must be between 1 and 5000 characters.');
  const { data: issue } = await db.from('issues').select('id').eq('id', id).maybeSingle();
  if (!issue) return failure('Issue not found.', 404);
  const { error } = await db.from('issue_comments').insert({ issue_id: id, body: text, created_by: actor.id });
  if (error) return failure(error.message);
  return { ok: true, issue: await getIssue(id) };
}

function mapIssue(row) {
  return {
    ...row,
    order_number: row.orders?.order_number || '',
    customer_name: row.orders?.customers?.name || '',
    customer_email: row.orders?.customers?.email || '',
    customer_phone: row.orders?.customers?.phone || '',
    assignee_name: row.assignee?.full_name || row.assignee?.email || '',
    creator_name: row.creator?.full_name || row.creator?.email || '',
    resolver_name: row.resolver?.full_name || row.resolver?.email || ''
  };
}

function compareIssues(a, b) {
  if (a.status === 'resolved' && b.status !== 'resolved') return 1;
  if (b.status === 'resolved' && a.status !== 'resolved') return -1;
  const aTarget = a.target_resolution_at ? new Date(a.target_resolution_at).getTime() : Number.POSITIVE_INFINITY;
  const bTarget = b.target_resolution_at ? new Date(b.target_resolution_at).getTime() : Number.POSITIVE_INFINITY;
  return aTarget - bTarget || new Date(a.created_at) - new Date(b.created_at);
}

function comparable(value) { return value === null || value === undefined ? null : String(value); }
function failure(error, status = 400) { return { ok: false, error, status }; }
