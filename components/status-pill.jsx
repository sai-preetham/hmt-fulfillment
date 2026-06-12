import { normalizeStatusLabel } from '@/lib/crm/data';

const danger = new Set(['issue_reported', 'failed_delivery', 'rto', 'rto_initiated', 'rto_delivered', 'lost_damaged', 'cancelled', 'warranty_case', 'installation_issue', 'negative_feedback', 'issue_escalated']);
const warn = new Set(['new', 'not_paid', 'awaiting_packing', 'pickup_pending', 'installation_pending', 'feedback_pending', 'customer_needs_help', 'not_contacted', 'fulfilled_no_tracking']);
const ok = new Set(['packed', 'booked', 'shipment_booked', 'picked_up', 'in_transit', 'in-transit', 'delivered', 'installed_successfully', 'positive_feedback', 'review_received', 'ugc_received', 'completed', 'paid', 'PAID', 'APPROVED']);
const info = new Set(['guide_sent', 'video_sent', 'installation_scheduled', 'review_requested', 'out_for_delivery', 'pending-international']);

export function StatusPill({ value }) {
  const key = value || 'not_set';
  const tone = danger.has(key) ? 'danger' : warn.has(key) ? 'warn' : ok.has(key) ? 'ok' : info.has(key) ? 'info' : 'neutral';
  return <span className={`pill ${tone}`}>{normalizeStatusLabel(key)}</span>;
}
