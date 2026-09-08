import { createSign } from 'node:crypto';
import { createServiceClient } from '../supabase/server.js';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const ORDERS_TAB = 'All Orders';
const SOURCING_TAB = 'Sourcing View';
const DAILY_DEMAND_TAB = 'Daily Item Demand';

/** Refreshes the sourcing workbook and posts the matching Discord digest. */
export async function runOrderExports({ trigger = 'manual' } = {}) {
  const supabase = createServiceClient();
  if (!supabase) return { ok: false, error: 'Supabase service client is not configured.' };
  try {
    const orders = await loadOrdersForExport(supabase);
    return {
      ok: true, trigger, orders: orders.length,
      sheet: await syncGoogleSheet(orders),
      discord: await postDiscordDailyOrders()
    };
  } catch (error) { return { ok: false, error: error.message || 'Order export failed.' }; }
}

/** Rebuilds one demand column per completed calendar date, preserving the existing matrix. */
export async function backfillDailyDemand({ startDate, endDate, timeZone = process.env.OPERATIONS_TIMEZONE || 'Asia/Kolkata' } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '')) throw new Error('startDate must use YYYY-MM-DD.');
  const supabase = createServiceClient();
  if (!supabase) throw new Error('Supabase service client is not configured.');
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('Google Sheets is not configured.');
  const finalDate = endDate || previousCalendarDayBounds(new Date(), timeZone).date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(finalDate) || startDate > finalDate) throw new Error('endDate must be on or after startDate.');
  const orders = await loadOrdersForExport(supabase);
  const token = await googleAccessToken();
  await ensureTabs(spreadsheetId, token, [DAILY_DEMAND_TAB]);
  const bounds = [];
  for (let date = startDate; date <= finalDate; date = nextCalendarDate(date)) bounds.push(calendarDateBounds(date, timeZone));
  await upsertDailyDemandColumns(spreadsheetId, token, orders, bounds);
  return { ok: true, startDate, endDate: finalDate, columns: bounds.length };
}

export function buildOrderRows(orders) {
  const header = ['Order #', 'Order date', 'Last updated', 'Order status', 'Payment status', 'Customer', 'Email', 'SKU', 'Product', 'Quantity', 'Unit price', 'Order total', 'Fulfillment status', 'Shipment status'];
  const rows = (orders || []).flatMap(order => (order.order_items?.length ? order.order_items : [{}]).map(item => [
    text(order.order_number || order.external_order_id || order.wix_order_id), isoDate(order.source_created_at || order.created_at), isoDate(order.source_updated_at || order.updated_at), text(order.status || order.internal_status), text(order.payment_status), text(order.customers?.name), text(order.customers?.email), text(item.sku), text(item.product_name), number(item.quantity, 0), number(item.item_price, 0), number(order.total_amount || order.total || order.price_summary?.total?.amount, 0), text(order.fulfillment_status), text(order.shipment_status)
  ]));
  return [header, ...rows];
}

export function buildSourcingRows(orders) {
  const stock = new Map();
  for (const order of orders || []) {
    if (isCancelled(order)) continue;
    for (const item of order.order_items || []) {
      const sku = text(item.sku) || 'UNSPECIFIED SKU';
      const current = stock.get(sku) || { product: text(item.product_name), quantity: 0, orders: new Set() };
      current.quantity += number(item.quantity, 0);
      if (order.order_number) current.orders.add(order.order_number);
      stock.set(sku, current);
    }
  }
  return [['SKU', 'Product', 'Units required (active orders)', 'Active orders'], ...[...stock.entries()].map(([sku, entry]) => [sku, entry.product, entry.quantity, entry.orders.size]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))];
}

export function buildDailyDemand(orders, bounds) {
  const items = new Map();
  for (const order of orders || []) {
    const createdAt = Date.parse(order.source_created_at || order.created_at || '');
    if (isCancelled(order) || !Number.isFinite(createdAt) || createdAt < Date.parse(bounds.start) || createdAt >= Date.parse(bounds.end)) continue;
    for (const item of order.order_items || []) {
      const sku = text(item.sku) || 'UNSPECIFIED SKU';
      const key = `${sku}\u0000${text(item.product_name)}`;
      const row = items.get(key) || { sku, product: text(item.product_name), quantity: 0 };
      row.quantity += number(item.quantity, 0);
      items.set(key, row);
    }
  }
  return [...items.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.product.localeCompare(b.product));
}

export function previousCalendarDayBounds(now = new Date(), timeZone = process.env.OPERATIONS_TIMEZONE || 'Asia/Kolkata') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const localToday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const localYesterday = new Date(localToday.getTime() - 86_400_000);
  const date = localYesterday.toISOString().slice(0, 10);
  return calendarDateBounds(date, timeZone);
}

export async function getPreviousDayOrderCount(now = new Date()) {
  const report = await getPreviousDayOrderReport(now);
  return { count: report.orderCount, ...report.bounds };
}

export async function getPreviousDayOrderReport(now = new Date()) {
  const supabase = createServiceClient();
  if (!supabase) throw new Error('Supabase service client is not configured.');
  const bounds = previousCalendarDayBounds(now);
  const [dailyResult, backlogResult] = await Promise.all([
    supabase.from('orders').select('status,payment_status,total_amount,shipping_address:customer_addresses!orders_shipping_address_id_fkey(country)').gte('source_created_at', bounds.start).lt('source_created_at', bounds.end),
    supabase.from('orders').select('status,fulfillment_status').limit(5000)
  ]);
  if (dailyResult.error) throw new Error(`Could not load previous-day orders: ${dailyResult.error.message}`);
  if (backlogResult.error) throw new Error(`Could not load unfulfilled orders: ${backlogResult.error.message}`);
  return { ...summarizePreviousDayOrders(dailyResult.data || []), unfulfilledCount: countUnfulfilledOrders(backlogResult.data || []), bounds };
}

export function summarizePreviousDayOrders(orders, goal = Number(process.env.DAILY_ORDER_GOAL || 5)) {
  const activeOrders = (orders || []).filter(order => !isCancelled(order));
  const paidOrders = activeOrders.filter(order => ['paid', 'approved'].includes(String(order.payment_status || '').toLowerCase()));
  return {
    orderCount: activeOrders.length,
    goal: Number.isFinite(goal) && goal > 0 ? goal : 5,
    totalPaid: paidOrders.reduce((total, order) => total + number(order.total_amount, 0), 0),
    internationalCount: activeOrders.filter(order => isInternational(order.shipping_address?.country)).length
  };
}

export function formatDiscordDailyReport(report) {
  const heading = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${report.bounds.date}T12:00:00.000Z`));
  return `**${heading}**\n\nOrder : ${report.orderCount}/${report.goal}\n\nTotal amount : ${formatCurrency(report.totalPaid)}\n\nInternational order : ${report.internationalCount}\n\nUnfulfilled order : ${report.unfulfilledCount}`;
}

export function countUnfulfilledOrders(orders) {
  return (orders || []).filter(order => !isCancelled(order) && String(order.fulfillment_status || '').trim().toUpperCase() !== 'FULFILLED').length;
}

async function loadOrdersForExport(supabase) {
  const { data, error } = await supabase.from('orders').select('order_number,external_order_id,wix_order_id,source_created_at,source_updated_at,created_at,updated_at,status,internal_status,payment_status,total_amount,fulfillment_status,shipment_status,customers(name,email),order_items(sku,product_name,quantity,item_price)').order('source_created_at', { ascending: false }).limit(5000);
  if (error) throw new Error(`Could not load orders for export: ${error.message}`);
  return data || [];
}

async function syncGoogleSheet(orders) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) return { skipped: true, reason: 'missing-google-sheets-config' };
  const token = await googleAccessToken();
  await ensureTabs(spreadsheetId, token, [ORDERS_TAB, SOURCING_TAB, DAILY_DEMAND_TAB]);
  await replaceTab(spreadsheetId, token, ORDERS_TAB, buildOrderRows(orders));
  await replaceTab(spreadsheetId, token, SOURCING_TAB, buildSourcingRows(orders));
  const bounds = previousCalendarDayBounds();
  await upsertDailyDemandColumn(spreadsheetId, token, orders, bounds);
  return { updated: true, spreadsheetId, tabs: [ORDERS_TAB, SOURCING_TAB, DAILY_DEMAND_TAB], demandDate: bounds.date };
}

export async function postDiscordDailyOrders(now = new Date()) {
  const webhookUrl = process.env.DISCORD_ORDERS_WEBHOOK_URL;
  if (!webhookUrl) return { skipped: true, reason: 'missing-discord-webhook-config' };
  const report = await getPreviousDayOrderReport(now);
  const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: formatDiscordDailyReport(report) }) });
  if (!response.ok) throw new Error(`Discord webhook failed (${response.status}).`);
  return { sent: true, date: report.bounds.date, count: report.orderCount, timeZone: report.bounds.timeZone };
}

async function googleAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Google Sheets needs GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: email, scope: GOOGLE_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256'); signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(privateKey).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(`Google authentication failed: ${payload.error_description || payload.error || response.status}`);
  return payload.access_token;
}

async function ensureTabs(id, token, titles) {
  const metadata = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`, token);
  const existing = new Set((metadata.sheets || []).map(sheet => sheet.properties.title));
  const requests = titles.filter(title => !existing.has(title)).map(title => ({ addSheet: { properties: { title } } }));
  if (requests.length) await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`, token, { requests });
}

async function replaceTab(id, token, tab, values, columnEnd = 'Z') {
  const range = encodeURIComponent(`${tab}!A:${columnEnd}`);
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}:clear`, token, {});
  await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=USER_ENTERED`, token, { values }, 'PUT');
}

async function upsertDailyDemandColumn(id, token, orders, bounds) {
  return upsertDailyDemandColumns(id, token, orders, [bounds]);
}

async function upsertDailyDemandColumns(id, token, orders, boundsList) {
  const range = encodeURIComponent(`${DAILY_DEMAND_TAB}!A:ZZ`);
  const existing = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}`, token);
  const rows = existing.values?.length ? existing.values : [['SKU', 'Product']];
  const header = rows[0];
  if (header[0] !== 'SKU' || header[1] !== 'Product') throw new Error(`${DAILY_DEMAND_TAB} must keep SKU and Product in columns A and B.`);
  const existingTotalIndex = rows.findIndex((row, index) => index > 0 && text(row[0]).trim().toUpperCase() === 'TOTAL');
  if (existingTotalIndex !== -1) rows.splice(existingTotalIndex, 1);
  const demandByDate = new Map(boundsList.map(bounds => [bounds.date, new Map(buildDailyDemand(orders, bounds).map(item => [`${item.sku}\u0000${item.product}`, item.quantity]))]));
  const columns = new Map();
  for (const bounds of boundsList) {
    let column = header.indexOf(bounds.date);
    if (column === -1) { column = header.length; header[column] = bounds.date; }
    columns.set(bounds.date, column);
  }
  const knownRows = new Map(rows.slice(1).map((row, index) => [`${text(row[0])}\u0000${text(row[1])}`, index + 1]));
  for (const quantities of demandByDate.values()) {
    for (const [key] of quantities) {
      if (knownRows.has(key)) continue;
      const [sku, product] = key.split('\u0000');
      knownRows.set(key, rows.length);
      rows.push([sku, product]);
    }
  }
  for (const [date, quantities] of demandByDate) {
    const column = columns.get(date);
    for (let index = 1; index < rows.length; index += 1) rows[index][column] = quantities.get(`${text(rows[index][0])}\u0000${text(rows[index][1])}`) || 0;
  }
  const width = Math.max(...rows.map(row => row.length));
  for (const row of rows) while (row.length < width) row.push('');
  const totalRow = ['TOTAL', 'All items'];
  for (let column = 2; column < width; column += 1) totalRow[column] = rows.slice(1).reduce((sum, row) => sum + number(row[column], 0), 0);
  rows.push(totalRow);
  await replaceTab(id, token, DAILY_DEMAND_TAB, rows, 'ZZ');
}

async function googleFetch(url, token, body, method) {
  const response = await fetch(url, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Sheets request failed (${response.status}): ${payload.error?.message || 'unknown error'}`);
  return payload;
}

function isCancelled(order) { return ['cancelled', 'canceled'].includes(String(order.status || order.internal_status || '').toLowerCase()); }
function isInternational(country) { return Boolean(country) && !['in', 'india'].includes(String(country).trim().toLowerCase()); }
function text(value) { return value === undefined || value === null ? '' : String(value); }
function number(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function isoDate(value) { const timestamp = Date.parse(value || ''); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''; }
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function formatCurrency(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: process.env.ORDER_REPORT_CURRENCY || 'INR', maximumFractionDigits: 2 }).format(value); }

function zonedMidnightToUtc(date, timeZone) {
  let utc = Date.parse(`${date}T00:00:00.000Z`);
  for (let i = 0; i < 3; i += 1) {
    const formatted = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utc));
    const parts = Object.fromEntries(formatted.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    utc -= observed - Date.parse(`${date}T00:00:00.000Z`);
  }
  return new Date(utc).toISOString();
}

function calendarDateBounds(date, timeZone) {
  return { date, start: zonedMidnightToUtc(date, timeZone), end: zonedMidnightToUtc(nextCalendarDate(date), timeZone), timeZone };
}

function nextCalendarDate(date) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}
