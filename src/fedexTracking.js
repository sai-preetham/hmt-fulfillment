let cachedToken = '';
let tokenExpiresAt = 0;

export async function fetchFedexTracking(waybills, config) {
  const result = new Map();
  if (!waybills.length) return result;

  const token = await getFedexToken(config);
  const url = new URL(`${config.fedex.baseUrl.replace(/\/$/, '')}/track/v1/trackingnumbers`);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    },
    body: JSON.stringify({
      trackingInfo: waybills.map(wb => ({
        trackingNumberInfo: {
          trackingNumber: wb
        }
      })),
      includeDetailedScans: true
    })
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`FedEx tracking API failed (${response.status}): ${JSON.stringify(body)}`);
  }

  const completeTrackResults = body?.output?.completeTrackResults || [];
  for (const item of completeTrackResults) {
    const waybill = item.trackingNumber;
    const trackResult = item.trackResults?.[0];
    if (waybill && trackResult) {
      result.set(waybill, trackResult);
    }
  }

  return result;
}

export function normalizeFedexStatus(fedexStatus) {
  const s = String(fedexStatus || '').toLowerCase().trim().replace(/_/g, ' ');

  if (s === 'dl' || s.includes('delivered')) return 'delivered';
  if (s === 'od' || s.includes('out for delivery') || s.includes('ofd')) return 'out-for-delivery';
  if (s === 'pu' || s.includes('picked up') || s.includes('pickup') || s.includes('pickedup')) return 'picked-up';
  if (s === 'it' || s.includes('in transit') || s.includes('transit') || s.includes('on way') || s.includes('departed') || s.includes('arrived') || s.includes('shipment') || s.includes('holding') || s.includes('clearance')) return 'in-transit';
  if (s === 'oc' || s.includes('initiated') || s.includes('manifested') || s.includes('label created') || s.includes('booked')) return 'booked';
  if (s.includes('return') || s.includes('rto')) return 'rto';
  if (s === 'de' || s === 'ca' || s.includes('cancel') || s.includes('lost') || s.includes('damaged') || s.includes('exception') || s.includes('fail') || s.includes('error')) return 'failed';

  return s ? 'in-transit' : 'booked';
}

export function getFedexLiveStatus(pkg) {
  if (pkg?.error || pkg?.errors) {
    return 'unknown';
  }
  return (
    pkg?.latestStatusDetail?.derivedStatus ||
    pkg?.latestStatusDetail?.description ||
    pkg?.latestStatusDetail?.code ||
    ''
  );
}

export function getFedexLiveLocation(pkg) {
  const loc = pkg?.latestStatusDetail?.scanLocation || pkg?.lastUpdatedDestinationAddress;
  if (!loc) return '';
  const parts = [loc.city, loc.stateOrProvinceCode || loc.stateOrProvince || loc.countryCode].filter(Boolean);
  return parts.join(', ');
}

export function extractFedexTrackingEvents(pkg) {
  const events = pkg?.scanEvents || [];
  return events.map(event => {
    const status = event.derivedStatus || event.eventDescription || event.eventType || '';
    const message = event.eventDescription || status || '';
    const loc = event.scanLocation;
    const locationStr = loc ? [loc.city, loc.stateOrProvinceCode || loc.stateOrProvince].filter(Boolean).join(', ') : '';

    return {
      event_status: status || message,
      normalized_status: normalizeFedexStatus(status || message),
      carrier_location: locationStr || null,
      message: message || null,
      occurred_at: parseFedexDate(event.date || event.timestamp),
      raw_event: event
    };
  });
}

async function getFedexToken(config) {
  if (!config.fedex.clientId || !config.fedex.clientSecret) {
    throw new Error('FedEx tracking requires FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET.');
  }

  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const url = new URL(`${config.fedex.baseUrl.replace(/\/$/, '')}/oauth/token`);

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', config.fedex.clientId);
  params.append('client_secret', config.fedex.clientSecret);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  const body = await safeJson(response);
  if (!response.ok || !body?.access_token) {
    throw new Error(`FedEx auth failed (${response.status}): ${JSON.stringify(body)}`);
  }

  cachedToken = body.access_token;
  const expiresInMs = (body.expires_in || 3600) * 1000;
  tokenExpiresAt = Date.now() + expiresInMs;

  return cachedToken;
}

function parseFedexDate(value) {
  if (!value) return new Date().toISOString();
  try {
    const d = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
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
