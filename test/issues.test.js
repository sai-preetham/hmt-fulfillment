import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyResolutionState, filterIssues, formatIssueAge, isIssueOverdue, validateIssueInput } from '../lib/crm/issue-model.js';
import { hasPermission, permissionForPath } from '../lib/access-control.js';

const now = new Date('2026-09-12T12:00:00.000Z');
const issues = [
  { id: '1', title: 'Courier delay', description: 'Package not moving', planned_resolution: 'Escalate to courier', order_number: '1001', customer_name: 'Anu', assignee_name: 'Ravi', assigned_user_id: 'u1', category: 'shipping', priority: 'urgent', status: 'blocked', created_at: '2026-09-10T07:30:00.000Z', target_resolution_at: '2026-09-11T12:00:00.000Z' },
  { id: '2', title: 'Fitment question', description: 'Needs guidance', planned_resolution: '', order_number: '1002', customer_name: 'Dev', assignee_name: '', assigned_user_id: null, category: 'installation', priority: 'medium', status: 'open', created_at: '2026-09-12T09:00:00.000Z', target_resolution_at: null },
  { id: '3', title: 'Payment corrected', description: 'Duplicate entry', planned_resolution: 'Correct ledger', order_number: '1003', customer_name: 'Sam', assignee_name: 'Nisha', assigned_user_id: 'u2', category: 'payment', priority: 'low', status: 'resolved', created_at: '2026-09-01T12:00:00.000Z', resolved_at: '2026-09-03T12:00:00.000Z', target_resolution_at: '2026-09-02T12:00:00.000Z' }
];

test('formats open and resolved issue durations', () => {
  assert.equal(formatIssueAge('2026-09-12T09:00:00.000Z', null, now), '3h');
  assert.equal(formatIssueAge('2026-09-10T07:30:00.000Z', null, now), '2d 4h');
  assert.equal(formatIssueAge(issues[2].created_at, issues[2].resolved_at, now), '2d');
  assert.equal(formatIssueAge('invalid', null, now), '—');
});

test('only unresolved issues can be overdue', () => {
  assert.equal(isIssueOverdue(issues[0], now), true);
  assert.equal(isIssueOverdue(issues[1], now), false);
  assert.equal(isIssueOverdue(issues[2], now), false);
});

test('filters issues across search, workflow, assignment, and overdue state', () => {
  assert.deepEqual(filterIssues(issues, { q: 'courier' }, now).map(issue => issue.id), ['1']);
  assert.deepEqual(filterIssues(issues, { assignee: 'unassigned' }, now).map(issue => issue.id), ['2']);
  assert.deepEqual(filterIssues(issues, { category: 'payment', status: 'resolved' }, now).map(issue => issue.id), ['3']);
  assert.deepEqual(filterIssues(issues, { overdue: 'overdue' }, now).map(issue => issue.id), ['1']);
  assert.deepEqual(filterIssues(issues, { overdue: 'no_target' }, now).map(issue => issue.id), ['2']);
});

test('issue permissions match the operating roles and custom overrides', () => {
  assert.equal(hasPermission({ active: true, role: 'operations_manager' }, 'issues.edit'), true);
  assert.equal(hasPermission({ active: true, role: 'viewer' }, 'issues.view'), true);
  assert.equal(hasPermission({ active: true, role: 'viewer' }, 'issues.edit'), false);
  assert.equal(hasPermission({ active: true, role: 'employee', custom_permissions: { 'issues.view': true } }, 'issues.view'), true);
  assert.equal(hasPermission({ active: false, role: 'admin' }, 'issues.view'), false);
  assert.equal(permissionForPath('/issues'), 'issues.view');
  assert.equal(permissionForPath('/api/crm/issues/abc', 'PATCH'), 'issues.edit');
});

test('issue validation rejects missing orders, inactive assignees, and invalid workflow values', async () => {
  const db = fakeValidationDb({ orders: new Set(['order-1']), activeUsers: new Set(['user-1']) });
  const validBase = { order_id: 'order-1', title: 'Broken bracket', description: 'Customer reported a crack', category: 'product', priority: 'high' };
  assert.match((await validateIssueInput(db, { ...validBase, order_id: 'missing' }, { creating: true })).error, /valid order/i);
  assert.match((await validateIssueInput(db, { ...validBase, assigned_user_id: 'inactive' }, { creating: true })).error, /active user/i);
  assert.match((await validateIssueInput(db, { ...validBase, category: 'unknown' }, { creating: true })).error, /category/i);
  assert.match((await validateIssueInput(db, { status: 'closed' })).error, /status/i);
});

test('resolving requires a final note and reopening clears resolution metadata', () => {
  const current = { status: 'open', final_resolution: null, resolved_by: null, resolved_at: null };
  assert.match(applyResolutionState(current, { status: 'resolved' }, { id: 'user-1' }, now).error, /final resolution/i);
  assert.deepEqual(applyResolutionState(current, { status: 'resolved', final_resolution: '  Replacement shipped  ' }, { id: 'user-1' }, now).value, { final_resolution: 'Replacement shipped', resolved_by: 'user-1', resolved_at: now.toISOString() });
  assert.deepEqual(applyResolutionState({ status: 'resolved', final_resolution: 'Done', resolved_by: 'user-1', resolved_at: now.toISOString() }, { status: 'open', final_resolution: 'Done' }, { id: 'user-2' }, now).value, { final_resolution: null, resolved_by: null, resolved_at: null });
});

function fakeValidationDb({ orders, activeUsers }) {
  return { from(table) { let value = ''; let activeOnly = false; return { select() { return this; }, eq(field, next) { if (field === 'id') value = next; if (field === 'active' && next === true) activeOnly = true; return this; }, async maybeSingle() { const found = table === 'orders' ? orders.has(value) : table === 'users' && activeOnly && activeUsers.has(value); return { data: found ? { id: value } : null }; } }; } };
}
