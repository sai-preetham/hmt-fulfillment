export function buildTrackingMessage(order, shipment) {
  const orderNumber = order.order_number || order.external_order_id || order.wix_order_id || order.id;
  const courier = shipment.courier_code || order.courier || 'courier';
  const awb = shipment.waybill || order.awb_number || order.shipment_waybill;
  const trackingUrl = shipment.tracking_url || order.tracking_url || trackingUrlFor(courier, awb);
  return [
    `Your Hold My Throttle order ${orderNumber} has been booked for shipment.`,
    `Courier: ${formatCourier(courier)}`,
    `Tracking number: ${awb}`,
    trackingUrl ? `Tracking link: ${trackingUrl}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export async function sendChatwootTrackingMessage(order, shipment, options = {}) {
  const baseUrl = trimTrailingSlash(process.env.CHATWOOT_BASE_URL || '');
  const accountId = process.env.CHATWOOT_ACCOUNT_ID || '';
  const token = process.env.CHATWOOT_API_TOKEN || process.env.CHATWOOT_ACCESS_TOKEN || '';
  const conversationId = order.chatwoot_conversation_id || options.conversationId || '';
  const content = options.content || buildTrackingMessage(order, shipment);

  if (!baseUrl || !accountId || !token) {
    return { skipped: true, reason: 'missing-chatwoot-config', content };
  }
  if (!conversationId) {
    return { skipped: true, reason: 'missing-chatwoot-conversation', content };
  }

  const response = await fetch(`${baseUrl}/api/v1/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: {
      'api-access-token': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      message_type: 'outgoing',
      private: false
    })
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(`Chatwoot tracking message failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return {
    status: 'sent',
    providerMessageId: payload.id || payload.message?.id || '',
    response: payload,
    content
  };
}

export async function getChatwootDailyTracker(bounds, options = {}) {
  const config = chatwootConfig(options.env);
  if (!config.baseUrl || !config.accountId || !config.token) {
    throw new Error('Chatwoot daily tracker needs CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID, and CHATWOOT_API_TOKEN.');
  }
  if (!bounds?.start || !bounds?.end || !bounds?.date) throw new Error('Chatwoot daily tracker needs valid calendar-day bounds.');

  const fetchImpl = options.fetchImpl || fetch;
  const since = Math.floor(Date.parse(bounds.start) / 1000);
  const until = Math.floor(Date.parse(bounds.end) / 1000) - 1;
  const [summary, open, pending] = await Promise.all([
    chatwootGet(config, '/api/v2/accounts/{accountId}/reports/summary', { type: 'account', since, until }, fetchImpl),
    listConversations(config, 'open', fetchImpl),
    listConversations(config, 'pending', fetchImpl)
  ]);

  return {
    bounds,
    openedCount: numericCount(summary.conversations_count),
    closedCount: numericCount(summary.resolutions_count),
    openCount: open.length,
    pendingCount: pending.length,
    assignees: summarizeAssigneeBacklog(open, pending)
  };
}

export function summarizeAssigneeBacklog(openConversations = [], pendingConversations = []) {
  const people = new Map();
  for (const [status, conversations] of [['open', openConversations], ['pending', pendingConversations]]) {
    for (const conversation of conversations) {
      const assignee = conversation.meta?.assignee || conversation.assignee || null;
      const id = assignee?.id === undefined || assignee?.id === null ? 'unassigned' : String(assignee.id);
      const name = assignee?.available_name || assignee?.name || (id === 'unassigned' ? 'Unassigned' : `Agent ${id}`);
      const entry = people.get(id) || { id, name, open: 0, pending: 0, total: 0 };
      entry[status] += 1;
      entry.total += 1;
      people.set(id, entry);
    }
  }
  return [...people.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function formatChatwootDailyTracker(report) {
  const heading = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${report.bounds.date}T12:00:00.000Z`));
  const assignees = report.assignees.length
    ? report.assignees.map(person => `• ${person.name}: ${person.total} (open ${person.open}, pending ${person.pending})`).join('\n')
    : '• No assigned or unassigned backlog';
  return truncateDiscordMessage([
    `**Chatwoot Daily Tracker — ${heading}**`,
    `Opened during the day: **${report.openedCount}**`,
    `Closed during the day: **${report.closedCount}**`,
    `Current backlog: **${report.openCount + report.pendingCount}** (open ${report.openCount}, pending ${report.pendingCount})`,
    '**Backlog by person**',
    assignees
  ].join('\n\n'));
}

export async function postDiscordChatwootDailyTracker(bounds, options = {}) {
  const env = options.env || process.env;
  const webhookUrl = env.DISCORD_CHATWOOT_WEBHOOK_URL || env.DISCORD_ORDERS_WEBHOOK_URL;
  if (!webhookUrl) return { skipped: true, reason: 'missing-discord-webhook-config' };
  const config = chatwootConfig(env);
  if (!config.baseUrl || !config.accountId || !config.token) return { skipped: true, reason: 'missing-chatwoot-config' };
  const report = await getChatwootDailyTracker(bounds, options);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: formatChatwootDailyTracker(report) })
  });
  if (!response.ok) throw new Error(`Discord Chatwoot webhook failed (${response.status}).`);
  return { sent: true, date: bounds.date, openedCount: report.openedCount, closedCount: report.closedCount, backlogCount: report.openCount + report.pendingCount };
}

async function listConversations(config, status, fetchImpl) {
  const conversations = [];
  for (let page = 1; page <= 200; page += 1) {
    const payload = await chatwootGet(config, '/api/v1/accounts/{accountId}/conversations', { status, assignee_type: 'all', page }, fetchImpl);
    const batch = payload.data?.payload || payload.payload || [];
    conversations.push(...batch);
    const total = numericCount(payload.data?.meta?.all_count ?? payload.meta?.all_count);
    if (!batch.length || (total > 0 && conversations.length >= total)) return conversations;
  }
  throw new Error(`Chatwoot ${status} conversation pagination exceeded 200 pages.`);
}

async function chatwootGet(config, path, query, fetchImpl) {
  const pathname = path.replace('{accountId}', encodeURIComponent(config.accountId));
  const url = new URL(`${config.baseUrl}${pathname}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  // Hyphens survive standard reverse proxies; Rails normalizes this to
  // HTTP_API_ACCESS_TOKEN, which Chatwoot accepts alongside api_access_token.
  const response = await fetchImpl(url, { headers: { 'api-access-token': config.token } });
  const payload = await safeJson(response);
  if (!response.ok) throw new Error(`Chatwoot request failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

function chatwootConfig(env = process.env) {
  return {
    baseUrl: trimTrailingSlash(env.CHATWOOT_BASE_URL || ''),
    accountId: env.CHATWOOT_ACCOUNT_ID || '',
    token: env.CHATWOOT_API_TOKEN || env.CHATWOOT_ACCESS_TOKEN || ''
  };
}

function numericCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

function truncateDiscordMessage(message) {
  if (message.length <= 2000) return message;
  return `${message.slice(0, 1960).trimEnd()}\n\n…additional assignees omitted`;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function formatCourier(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function trackingUrlFor(courier, awb) {
  if (!awb) return '';
  if (courier === 'shiprocket') return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  if (courier === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(awb)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(awb)}`;
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
