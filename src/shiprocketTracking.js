let cachedToken = '';

export async function fetchShiprocketTracking(waybills, config) {
  const result = new Map();
  if (!waybills.length) return result;

  const token = await getShiprocketToken(config);

  for (const waybill of waybills) {
    const url = new URL(`${config.shiprocket.baseUrl.replace(/\/$/, '')}/courier/track/awb/${encodeURIComponent(waybill)}`);
    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });

    const body = await safeJson(response);
    if (!response.ok) {
      throw new Error(`Shiprocket tracking API failed for AWB ${waybill} (${response.status}): ${JSON.stringify(body)}`);
    }

    result.set(waybill, body?.tracking_data || body);
  }

  return result;
}

export function normalizeShiprocketStatus(rawStatus) {
  const statusCode = Number(rawStatus);
  if (Number.isInteger(statusCode) && SHIPROCKET_STATUS_CODE_MAP[statusCode]) {
    return SHIPROCKET_STATUS_CODE_MAP[statusCode];
  }

  const status = String(rawStatus || '').toLowerCase().trim().replace(/_/g, ' ');

  if (status.startsWith('rto') || status.includes(' rto ') || status.includes('return')) return 'rto';
  if (status.includes('delivered')) return 'delivered';
  if (status.includes('out for delivery') || status.includes('ofd')) return 'out-for-delivery';
  if (status.includes('in transit') || status.includes('shipped') || status.includes('reached')) return 'in-transit';
  if (status.includes('picked up') || status.includes('pickup generated') || status.includes('pickup scheduled')) return 'picked-up';
  if (status.includes('awb assigned') || status.includes('shipment booked') || status.includes('booked')) return 'booked';
  if (
    status.includes('cancel') ||
    status.includes('lost') ||
    status.includes('damaged') ||
    status.includes('destroyed') ||
    status.includes('pickup error')
  ) {
    return 'failed';
  }

  return status ? 'in-transit' : 'booked';
}

const SHIPROCKET_STATUS_CODE_MAP = {
  6: 'in-transit',
  7: 'delivered',
  8: 'failed',
  9: 'rto',
  10: 'rto',
  12: 'failed',
  13: 'failed',
  14: 'rto',
  15: 'picked-up',
  16: 'failed',
  17: 'out-for-delivery',
  18: 'in-transit',
  19: 'picked-up',
  20: 'failed',
  21: 'failed',
  22: 'in-transit',
  23: 'delivered',
  24: 'failed',
  25: 'failed',
  26: 'delivered',
  27: 'booked',
  38: 'in-transit',
  39: 'in-transit',
  40: 'rto',
  41: 'rto',
  42: 'picked-up',
  43: 'delivered',
  44: 'failed',
  45: 'failed',
  46: 'rto',
  47: 'failed',
  48: 'in-transit',
  49: 'in-transit',
  50: 'in-transit',
  51: 'in-transit',
  52: 'booked',
  54: 'in-transit',
  55: 'in-transit',
  56: 'in-transit',
  57: 'in-transit',
  59: 'booked',
  60: 'booked',
  61: 'booked',
  62: 'booked',
  63: 'booked',
  67: 'booked',
  68: 'in-transit',
  71: 'failed',
  72: 'failed',
  75: 'rto',
  76: 'failed',
  77: 'failed',
  78: 'rto'
};

export function getShiprocketLiveStatus(pkg) {
  return (
    pkg?.shipment_status ||
    pkg?.shipment_status_code ||
    pkg?.current_status ||
    pkg?.currentStatus ||
    pkg?.status ||
    pkg?.shipment_track?.[0]?.current_status ||
    pkg?.shipment_track?.[0]?.delivered_date ||
    ''
  );
}

export function getShiprocketLiveLocation(pkg) {
  const activities = getShiprocketActivities(pkg);
  return activities[0]?.location || activities[0]?.sr_location || pkg?.shipment_track?.[0]?.destination || '';
}

export function extractShiprocketTrackingEvents(pkg) {
  return getShiprocketActivities(pkg).map(activity => {
    const status = activity.status || activity['status '] || activity.current_status || '';
    const message = activity.activity || activity.remarks || activity.message || status || '';
    return {
      event_status: status || message,
      normalized_status: normalizeShiprocketStatus(status || message),
      carrier_location: activity.location || activity.sr_location || null,
      message: message || null,
      occurred_at: parseShiprocketDate(activity.date || activity.event_time || activity.created_at),
      raw_event: activity
    };
  });
}

async function getShiprocketToken(config) {
  if (config.shiprocket.token) return config.shiprocket.token;
  if (cachedToken) return cachedToken;
  if (!config.shiprocket.email || !config.shiprocket.password) {
    throw new Error('Shiprocket tracking requires SHIPROCKET_API_TOKEN or SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD.');
  }

  const url = new URL(`${config.shiprocket.baseUrl.replace(/\/$/, '')}/auth/login`);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      email: config.shiprocket.email,
      password: config.shiprocket.password
    })
  });

  const body = await safeJson(response);
  if (!response.ok || !body?.token) {
    throw new Error(`Shiprocket auth failed (${response.status}): ${JSON.stringify(body)}`);
  }
  cachedToken = body.token;
  return cachedToken;
}

function getShiprocketActivities(pkg) {
  const activities =
    pkg?.shipment_track_activities ||
    pkg?.track_activities ||
    pkg?.activities ||
    pkg?.scans ||
    [];
  return Array.isArray(activities) ? activities : [];
}

function parseShiprocketDate(value) {
  if (!value) return new Date().toISOString();
  const parsed = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
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
