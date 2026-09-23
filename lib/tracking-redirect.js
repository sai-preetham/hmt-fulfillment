const TRACKING_ID_PATTERN = /^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{5,64}$/;

export function normalizeTrackingId(value) {
  const trackingId = String(value || '').trim();
  return TRACKING_ID_PATTERN.test(trackingId) ? trackingId : '';
}

export function carrierTrackingUrl(courier, trackingId) {
  const waybill = normalizeTrackingId(trackingId);
  if (!waybill) return '';
  const normalized = String(courier || '').trim().toLowerCase().replaceAll('_', '-');
  if (normalized.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(waybill)}`;
  if (normalized.includes('shiprocket')) return `https://shiprocket.co/tracking/${encodeURIComponent(waybill)}`;
  return `https://www.delhivery.com/track/package/${encodeURIComponent(waybill)}`;
}

export async function resolveTrackingRedirect(db, trackingId) {
  const waybill = normalizeTrackingId(trackingId);
  if (!waybill) return { ok: false, status: 400, error: 'Invalid tracking ID.' };
  if (!db) return { ok: false, status: 503, error: 'Tracking service is temporarily unavailable.' };
  const { data: shipment, error } = await db
    .from('shipments')
    .select('waybill,courier_code')
    .eq('waybill', waybill)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: 'Tracking service is temporarily unavailable.' };
  if (!shipment) return { ok: false, status: 404, error: 'Tracking ID not found.' };
  return { ok: true, url: carrierTrackingUrl(shipment.courier_code, shipment.waybill) };
}
