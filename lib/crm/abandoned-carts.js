import { createServiceClient } from '@/lib/supabase/server';
import { findRecoveryMatch, normalizeEmail, normalizePhone } from './abandoned-cart-matching.js';

export const LEAD_STAGES = ['new', 'contacted', 'follow_up', 'not_interested', 'closed'];
const PAID_STATUSES = new Set(['paid', 'approved']);

export async function syncAbandonedCartLeads() {
  const db = createServiceClient();
  if (!db) return { ok: false, error: 'Supabase is not configured.' };
  const { getConfig } = await import('@/src/config.js');
  const config = getConfig();
  const carts = await fetchAllAbandonedCheckouts(config);
  if (!carts.ok) return carts;

  const rows = [];
  for (const cart of carts.items) {
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
  if (rows.length) {
    const { error } = await db.from('abandoned_cart_leads').upsert(rows, { onConflict: 'wix_abandoned_checkout_id' });
    if (error) return { ok: false, error: error.message };
  }
  const recovery = await detectRecoveries(db);
  if (!recovery.ok) return recovery;
  return { ok: true, synced: rows.length, pages: carts.pages, recovered: recovery.recovered };
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
