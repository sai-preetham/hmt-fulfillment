export function findRecoveryMatch(lead, orders) {
  const cartCreatedAt = Date.parse(lead.wix_created_at || '');
  if (!Number.isFinite(cartCreatedAt)) return null;
  const leadContactId = lead.raw_data?.buyerInfo?.contactId || '';
  const candidates = orders
    .filter(order => Date.parse(order.source_created_at || '') > cartCreatedAt)
    .sort((a, b) => Date.parse(a.source_created_at) - Date.parse(b.source_created_at));
  if (leadContactId) {
    const order = candidates.find(candidate => candidate.customers?.wix_contact_id === leadContactId);
    return order ? { order, method: 'wix_contact_id' } : null;
  }
  const email = normalizeEmail(lead.email);
  if (email) {
    const order = candidates.find(candidate => normalizeEmail(candidate.customers?.email) === email);
    if (order) return { order, method: 'email' };
  }
  const phone = normalizePhone(lead.phone);
  if (phone) {
    const order = candidates.find(candidate => normalizePhone(candidate.customers?.phone) === phone);
    if (order) return { order, method: 'phone' };
  }
  return null;
}

export function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
export function normalizePhone(value) { return String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); }
