import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrderConfirmationTemplate, formatChatwootDailyTracker, getChatwootDailyTracker, sendChatwootAbandonedCartFollowUp, sendChatwootOrderConfirmation, summarizeAssigneeBacklog } from '../lib/crm/chatwoot.js';

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

test('builds approved order confirmation variables from an Ops order', () => {
  const template = buildOrderConfirmationTemplate({
    order_number: '#12345',
    customers: { name: 'John' },
    order_items: [{ product_name: 'Himalayan 450' }]
  });
  assert.equal(template.customerName, 'John');
  assert.equal(template.orderNumber, '#12345');
  assert.equal(template.product, 'Himalayan 450');
  assert.match(template.content, /Hello John/);
});

test('sends the approved Meta template through an existing Chatwoot conversation', async () => {
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.pathname.endsWith('/contacts/search')) {
      return jsonResponse({ payload: [{ id: 56, name: 'John', phone_number: '+919876543210', contact_inboxes: [{ source_id: '919876543210', inbox: { id: 1 } }] }] });
    }
    if (url.pathname.endsWith('/contacts/56/conversations')) return jsonResponse({ payload: [{ id: 1303, inbox_id: 1, status: 'resolved' }] });
    if (url.pathname.endsWith('/conversations/1303/messages')) return jsonResponse({ id: 19320, status: 'sent' });
    return jsonResponse({ error: 'unexpected' }, 404);
  };

  const result = await sendChatwootOrderConfirmation({
    id: 'order-id',
    order_number: '#12345',
    customers: { name: 'John', phone: '98765 43210' },
    order_items: [{ product_name: 'Himalayan 450' }]
  }, {
    inboxId: '1',
    templateName: 'order_management_no_cta_5',
    language: 'en_US',
    category: 'UTILITY',
    fetchImpl,
    env: { CHATWOOT_BASE_URL: 'https://chat.example.com/', CHATWOOT_ACCOUNT_ID: '7', CHATWOOT_API_TOKEN: 'token' }
  });

  assert.equal(result.providerMessageId, '19320');
  assert.equal(result.conversationId, '1303');
  const message = requests.find(request => request.url.pathname.endsWith('/conversations/1303/messages'));
  const body = JSON.parse(message.options.body);
  assert.deepEqual(body.template_params.processed_params.body, { 1: 'John', 2: '#12345', 3: 'Himalayan 450' });
  assert.equal(body.template_params.language, 'en_US');
});

test('creates a Chatwoot contact and conversation when the buyer is new', async () => {
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.pathname.endsWith('/contacts/search')) return jsonResponse({ payload: [] });
    if (url.pathname.endsWith('/contacts') && options.method === 'POST') {
      return jsonResponse({ payload: { contact: { id: 70, phone_number: '+919999999999', contact_inboxes: [{ source_id: '919999999999', inbox: { id: 1 } }] } } });
    }
    if (url.pathname.endsWith('/contacts/70/conversations')) return jsonResponse({ payload: [] });
    if (url.pathname.endsWith('/conversations') && options.method === 'POST') return jsonResponse({ id: 1400, inbox_id: 1 });
    if (url.pathname.endsWith('/conversations/1400/messages')) return jsonResponse({ id: 19400, status: 'sent' });
    return jsonResponse({ error: 'unexpected' }, 404);
  };

  const result = await sendChatwootOrderConfirmation({
    id: 'new-order', order_number: '1002', customers: { name: 'Asha', phone: '09999999999' }, order_items: [{ product_name: 'KTM 390' }]
  }, {
    inboxId: '1', fetchImpl,
    env: { CHATWOOT_BASE_URL: 'https://chat.example.com', CHATWOOT_ACCOUNT_ID: '7', CHATWOOT_API_TOKEN: 'token' }
  });

  assert.equal(result.conversationId, '1400');
  const contact = requests.find(request => request.url.pathname.endsWith('/contacts') && request.options.method === 'POST');
  assert.equal(JSON.parse(contact.options.body).phone_number, '+919999999999');
  const conversation = requests.find(request => request.url.pathname.endsWith('/conversations') && request.options.method === 'POST');
  assert.deepEqual(JSON.parse(conversation.options.body), { source_id: '919999999999', inbox_id: 1, contact_id: 70, status: 'open' });
});

test('sends abandoned_cart with customer, motorcycle, and checkout URL parameters', async () => {
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.pathname.endsWith('/contacts/search')) return jsonResponse({ payload: [{ id: 56, phone_number: '+919876543210' }] });
    if (url.pathname.endsWith('/contacts/56/conversations')) return jsonResponse({ payload: [{ id: 1303, inbox_id: 1 }] });
    if (url.pathname.endsWith('/conversations/1303/messages')) return jsonResponse({ id: 19321 });
    return jsonResponse({ error: 'unexpected' }, 404);
  };

  await sendChatwootAbandonedCartFollowUp({
    customer_name: 'John', phone: '98765 43210',
    checkout_url: 'https://www.holdmythrottle.com/product-page/scrambler-400-x-hmt',
    items: [{ name: 'HMT Cruise Kit - Himalayan 450' }]
  }, {
    inboxId: '1', templateName: 'abandoned_cart', buttonUrl: 'https://www.holdmythrottle.com/product-page/{{1}}', fetchImpl,
    env: { CHATWOOT_BASE_URL: 'https://chat.example.com', CHATWOOT_ACCOUNT_ID: '7', CHATWOOT_API_TOKEN: 'token' }
  });

  const message = requests.find(request => request.url.pathname.endsWith('/conversations/1303/messages'));
  const template = JSON.parse(message.options.body).template_params;
  assert.equal(template.name, 'abandoned_cart');
  assert.deepEqual(template.processed_params.body, { a: 'John', b: 'Himalayan 450' });
  assert.deepEqual(template.processed_params.buttons, [{ type: 'url', parameter: 'scrambler-400-x-hmt', url: 'https://www.holdmythrottle.com/product-page/{{1}}', variables: ['1'] }]);
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
