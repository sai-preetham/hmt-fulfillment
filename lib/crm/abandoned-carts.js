import { createServiceClient } from '../supabase/server.js';
import { findRecoveryMatch, normalizeEmail, normalizePhone } from './abandoned-cart-matching.js';

export const LEAD_STAGES = ['new', 'contacted', 'follow_up', 'not_interested', 'closed'];
const PAID_STATUSES = new Set(['paid', 'approved']);

export async function syncAbandonedCartLeads(options = {}) {
  const db = createServiceClient();
  if (!db) return { ok: false, error: 'Supabase is not configured.' };
  const { getConfig } = await import('../../src/config.js');
  const config = getConfig();
  const wixCarts = await fetchAllAbandonedCheckouts(config);
  if (!wixCarts.ok) return wixCarts;
  const wooCarts = await fetchAllWooCommerceAbandonedCarts(config, options);
  if (!wooCarts.ok) return wooCarts;

  const rows = [];
  for (const cart of wixCarts.items) {
    const name = [cart.contactDetails?.firstName, cart.contactDetails?.lastName].filter(Boolean).join(' ');
    const email = cart.buyerInfo?.email || cart.contactDetails?.email || '';
    const phone = cart.contactDetails?.phone || '';
    let customerId = null;
    if (email || phone || cart.buyerInfo?.contactId) {
      const contactId = cart.buyerInfo?.contactId || `wix-abandoned-${cart.id}`;
      const { data, error } = await db
        .from('customers')
        .upsert({ wix_contact_id: contactId, name, email, phone, raw_customer: cart.buyerInfo || {} }, { onConflict: 'wix_contact_id' })
        .select('id')
        .single();
      if (error) return { ok: false, error: error.message };
      customerId = data.id;
    }
    rows.push({
      source: 'wix',
      external_cart_id: String(cart.id),
      wix_abandoned_checkout_id: cart.id,
      customer_id: customerId,
      customer_name: name,
      email,
      phone,
      cart_value: cart.totalPrice?.amount || 0,
      currency: cart.currency || '',
      checkout_url: cart.checkoutUrl || '',
      items: cart.lineItems || [],
      wix_status: cart.status || '',
      wix_created_at: cart.createdDate,
      wix_updated_at: cart.updatedDate,
      raw_data: cart
    });
  }
  for (const cart of wooCarts.items) {
    const row = normalizeWooCommerceAbandonedCart(cart);
    let customerId = null;
    if (row.email || row.phone) {
      const { data, error } = await db
        .from('customers')
        .upsert({ wix_contact_id: `woo-abandoned-${row.external_cart_id}`, name: row.customer_name, email: row.email, phone: row.phone, raw_customer: cart.billing || {} }, { onConflict: 'wix_contact_id' })
        .select('id')
        .single();
      if (error) return { ok: false, error: error.message };
      customerId = data.id;
    }
    rows.push({ ...row, customer_id: customerId });
  }
  if (rows.length) {
    const { error } = await db.from('abandoned_cart_leads').upsert(rows, { onConflict: 'source,external_cart_id' });
    if (error) return { ok: false, error: error.message };
  }
  const recovery = await detectRecoveries(db);
  if (!recovery.ok) return recovery;
  const messages = await sendWooCommerceFollowUps(db, config, options);
  return {
    ok: messages.failed === 0,
    synced: rows.length,
    wixSynced: wixCarts.items.length,
    wooCommerceSynced: wooCarts.items.length,
    pages: wixCarts.pages + wooCarts.pages,
    recovered: recovery.recovered,
    followUpsSent: messages.sent,
    followUpsSkipped: messages.skipped,
    followUpsFailed: messages.failed,
    error: messages.failed ? `${messages.failed} WhatsApp follow-up(s) failed and will be retried.` : undefined
  };
}

export async function listAbandonedCartLeads() {
  const db = createServiceClient();
  if (!db) return [];
  const { data } = await db.from('abandoned_cart_leads').select('*').order('wix_updated_at', { ascending: false }).limit(500);
  return data || [];
}

export async function getAbandonedCartLead(id) {
  const db = createServiceClient();
  if (!db || !id) return null;
  const { data: lead } = await db.from('abandoned_cart_leads').select('*').eq('id', id).maybeSingle();
  if (!lead) return null;
  const { data: recoveredOrder } = lead.recovered_order_id
    ? await db.from('orders').select('id,order_number,external_order_id,payment_status,total_amount,currency,source_created_at').eq('id', lead.recovered_order_id).maybeSingle()
    : { data: null };
  return { ...lead, recovered_order: recoveredOrder };
}

export async function updateAbandonedCartLead(id, payload) {
  const db = createServiceClient();
  if (!db) return { ok: false, error: 'Supabase is not configured.' };
  const leadStatus = String(payload.lead_status || '');
  if (!LEAD_STAGES.includes(leadStatus)) return { ok: false, error: 'Choose a valid lead stage.' };
  const patch = {
    lead_status: leadStatus,
    call_outcome: cleanText(payload.call_outcome, 120),
    notes: cleanText(payload.notes, 5000),
    next_follow_up_at: parseDate(payload.next_follow_up_at),
    last_contacted_at: parseDate(payload.last_contacted_at),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await db.from('abandoned_cart_leads').update(patch).eq('id', id).select('*').maybeSingle();
  return error ? { ok: false, error: error.message } : { ok: true, lead: data };
}

export async function fetchAllAbandonedCheckouts(config) {
  const items = [];
  const maxPages = Math.max(1, Math.min(Number(process.env.WIX_ABANDONED_CART_MAX_PAGES || 50), 100));
  let cursor = '';
  let pages = 0;
  do {
    pages += 1;
    const query = { paging: { limit: 100 }, sort: [{ fieldName: 'updatedDate', order: 'DESC' }] };
    if (cursor) query.paging.cursor = cursor;
    const response = await fetch('https://www.wixapis.com/ecom/v1/abandoned-checkout/query', {
      method: 'POST',
      headers: { Authorization: config.wix.authToken, 'Content-Type': 'application/json', 'wix-site-id': config.wix.siteId },
      body: JSON.stringify({ query })
    });
    const body = await response.json();
    if (!response.ok) return { ok: false, error: body.message || `Wix request failed (${response.status}).` };
    items.push(...(body.abandonedCheckouts || body.results || []));
    cursor = body.pagingMetadata?.cursors?.next || body.metadata?.cursors?.next || '';
  } while (cursor && pages < maxPages);
  return { ok: true, items, pages, stoppedByMaxPages: Boolean(cursor) };
}

export async function fetchAllWooCommerceAbandonedCarts(config, options = {}) {
  const settings = config.woocommerce?.abandonedCartSync || {};
  if (!settings.enabled) return { ok: true, items: [], pages: 0, skipped: 'disabled' };
  if (!config.woocommerce?.baseUrl || !config.woocommerce?.consumerKey || !config.woocommerce?.consumerSecret) {
    return { ok: false, error: 'WooCommerce abandoned-cart sync needs WOO_BASE_URL, WOO_CONSUMER_KEY, and WOO_CONSUMER_SECRET.' };
  }
  const { fetchWooCommerceAbandonedCarts } = await import('../../src/woocommerce.js');
  const fetchCarts = options.fetchWooCommerceAbandonedCarts || fetchWooCommerceAbandonedCarts;
  const items = [];
  let page = 0;
  let hasMore = false;
  do {
    page += 1;
    const result = await fetchCarts(config, { page, perPage: settings.pageSize || 50 });
    items.push(...(result.orders || []));
    hasMore = Boolean(result.hasMore);
  } while (hasMore && page < (settings.maxPages || 10));
  const cutoff = Date.now() - (settings.minimumAgeMinutes || 60) * 60_000;
  return {
    ok: true,
    items: items.filter(cart => wooCartTimestamp(cart) <= cutoff),
    pages: page,
    stoppedByMaxPages: hasMore
  };
}

export function normalizeWooCommerceAbandonedCart(cart = {}) {
  const billing = cart.billing || {};
  const createdAt = wooDate(cart.date_created_gmt || cart.date_created);
  const updatedAt = wooDate(cart.date_modified_gmt || cart.date_modified || cart.date_created_gmt || cart.date_created);
  return {
    source: 'woocommerce',
    external_cart_id: String(cart.id),
    wix_abandoned_checkout_id: null,
    customer_name: [billing.first_name, billing.last_name].filter(Boolean).join(' '),
    email: billing.email || '',
    phone: billing.phone || '',
    cart_value: Number(cart.total || 0),
    currency: cart.currency || '',
    checkout_url: cart.payment_url || '',
    items: cart.line_items || [],
    wix_status: cart.status || 'checkout-draft',
    wix_created_at: createdAt,
    wix_updated_at: updatedAt,
    raw_data: cart
  };
}

export async function sendWooCommerceFollowUps(db, config, options = {}) {
  const settings = config.woocommerce?.abandonedCartSync || {};
  if (!settings.sendWhatsApp) return { sent: 0, skipped: 0, failed: 0 };
  const { sendChatwootAbandonedCartFollowUp } = await import('./chatwoot.js');
  const send = options.sendChatwootAbandonedCartFollowUp || sendChatwootAbandonedCartFollowUp;
  const result = { sent: 0, skipped: 0, failed: 0 };
  for (let count = 0; count < 100; count += 1) {
    const { data: claimed, error: claimError } = await db.rpc('claim_woo_abandoned_cart_follow_up');
    if (claimError) return { ...result, failed: result.failed + 1 };
    const lead = claimed?.[0];
    if (!lead) break;
    try {
      const message = await send(lead, {
        inboxId: config.chatwoot?.inboxId,
        templateName: settings.templateName,
        language: settings.templateLanguage,
        category: settings.templateCategory,
        buttonUrl: settings.templateButtonUrl
      });
      const skipped = Boolean(message.skipped);
      await db.from('abandoned_cart_leads').update({
        follow_up_status: skipped ? 'skipped' : 'sent',
        follow_up_sent_at: skipped ? null : new Date().toISOString(),
        follow_up_error: skipped ? message.reason : null,
        follow_up_provider_message_id: message.providerMessageId || null,
        updated_at: new Date().toISOString()
      }).eq('id', lead.id).is('follow_up_sent_at', null);
      result[skipped ? 'skipped' : 'sent'] += 1;
    } catch (sendError) {
      await db.from('abandoned_cart_leads').update({ follow_up_status: 'failed', follow_up_error: sendError.message, updated_at: new Date().toISOString() }).eq('id', lead.id);
      result.failed += 1;
    }
  }
  return result;
}

export async function detectRecoveries(db) {
  const [{ data: leads, error: leadError }, { data: orders, error: orderError }] = await Promise.all([
    db.from('abandoned_cart_leads').select('id,customer_id,email,phone,wix_created_at,raw_data,recovered_order_id').is('recovered_order_id', null).not('wix_created_at', 'is', null).limit(1000),
    db.from('orders').select('id,customer_id,payment_status,source_created_at,customers(wix_contact_id,email,phone)').not('source_created_at', 'is', null).limit(5000)
  ]);
  if (leadError || orderError) return { ok: false, error: leadError?.message || orderError?.message };
  const paidOrders = (orders || []).filter(order => PAID_STATUSES.has(String(order.payment_status || '').toLowerCase()));
  const patches = [];
  for (const lead of leads || []) {
    const match = findRecoveryMatch(lead, paidOrders);
    if (match) patches.push({ id: lead.id, recovered_order_id: match.order.id, recovered_at: match.order.source_created_at, recovery_match_method: match.method, updated_at: new Date().toISOString() });
  }
  for (const patch of patches) {
    const { error } = await db.from('abandoned_cart_leads').update(patch).eq('id', patch.id).is('recovered_order_id', null);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, recovered: patches.length };
}

function cleanText(value, limit) { return String(value || '').trim().slice(0, limit) || null; }
function parseDate(value) { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function wooCartTimestamp(cart) { return Date.parse(wooDate(cart.date_modified_gmt || cart.date_modified || cart.date_created_gmt || cart.date_created)) || 0; }
function wooDate(value) { if (!value) return null; const text = String(value); return /Z$|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`; }
