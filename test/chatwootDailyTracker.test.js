import assert from 'node:assert/strict';
import test from 'node:test';
import { formatChatwootDailyTracker, getChatwootDailyTracker, summarizeAssigneeBacklog } from '../lib/crm/chatwoot.js';

const bounds = {
  date: '2026-09-14',
  start: '2026-09-13T18:30:00.000Z',
  end: '2026-09-14T18:30:00.000Z',
  timeZone: 'Asia/Kolkata'
};

test('groups current open and pending Chatwoot conversations by assignee', () => {
  const assignees = summarizeAssigneeBacklog(
    [{ meta: { assignee: { id: 1, name: 'Asha' } } }, { meta: { assignee: null } }],
    [{ meta: { assignee: { id: 1, name: 'Asha' } } }, { meta: { assignee: { id: 2, available_name: 'Ravi' } } }]
  );
  assert.deepEqual(assignees, [
    { id: '1', name: 'Asha', open: 1, pending: 1, total: 2 },
    { id: '2', name: 'Ravi', open: 0, pending: 1, total: 1 },
    { id: 'unassigned', name: 'Unassigned', open: 1, pending: 0, total: 1 }
  ]);
});

test('loads exact daily counts and paginated current backlog from Chatwoot', async () => {
  const requests = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push(url);
    assert.equal(options.headers['api-access-token'], 'token');
    if (url.pathname.endsWith('/reports/summary')) return jsonResponse({ conversations_count: 12, resolutions_count: 9 });
    const status = url.searchParams.get('status');
    const page = Number(url.searchParams.get('page'));
    if (status === 'open' && page === 1) return jsonResponse({ data: { meta: { all_count: 2 }, payload: [{ meta: { assignee: { id: 1, name: 'Asha' } } }, { meta: { assignee: null } }] } });
    if (status === 'pending' && page === 1) return jsonResponse({ data: { meta: { all_count: 1 }, payload: [{ meta: { assignee: { id: 1, name: 'Asha' } } }] } });
    return jsonResponse({ data: { meta: { all_count: 0 }, payload: [] } });
  };

  const report = await getChatwootDailyTracker(bounds, {
    fetchImpl,
    env: { CHATWOOT_BASE_URL: 'https://chat.example.com/', CHATWOOT_ACCOUNT_ID: '7', CHATWOOT_API_TOKEN: 'token' }
  });

  assert.equal(report.openedCount, 12);
  assert.equal(report.closedCount, 9);
  assert.equal(report.openCount, 2);
  assert.equal(report.pendingCount, 1);
  assert.equal(report.assignees[0].name, 'Asha');
  const summaryUrl = requests.find(url => url.pathname.endsWith('/reports/summary'));
  assert.equal(summaryUrl.searchParams.get('since'), '1789324200');
  assert.equal(summaryUrl.searchParams.get('until'), '1789410599');
});

test('formats a readable Discord tracker', () => {
  const message = formatChatwootDailyTracker({
    bounds,
    openedCount: 12,
    closedCount: 9,
    openCount: 3,
    pendingCount: 2,
    assignees: [{ id: '1', name: 'Asha', open: 2, pending: 1, total: 3 }]
  });
  assert.match(message, /Opened during the day: \*\*12\*\*/);
  assert.match(message, /Current backlog: \*\*5\*\*/);
  assert.match(message, /Asha: 3 \(open 2, pending 1\)/);
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
