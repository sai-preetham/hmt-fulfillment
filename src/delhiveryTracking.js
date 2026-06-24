/**
 * Delhivery automatic tracking sync.
 *
 * Periodically fetches live shipment status from the Delhivery tracking API
 * for all active booked shipments, saves events to `shipment_events`, and
 * updates `shipments.status` + `orders.shipment_status`.
 *
 * No Wix push-back — status changes stay internal only.
 */

import { isSupabaseConfigured } from './supabase.js';
import {
  listActiveShipmentWaybills,
  saveTrackingEvents,
  updateShipmentTracking
} from './store.js';
import {
  extractShiprocketTrackingEvents,
  fetchShiprocketTracking,
  getShiprocketLiveLocation,
  getShiprocketLiveStatus,
  normalizeShiprocketStatus
} from './shiprocketTracking.js';
import {
  extractFedexTrackingEvents,
  fetchFedexTracking,
  getFedexLiveLocation,
  getFedexLiveStatus,
  normalizeFedexStatus
} from './fedexTracking.js';

// ---------------------------------------------------------------------------
// Delhivery tracking API
// ---------------------------------------------------------------------------

/**
 * Fetch tracking data for up to `batchSize` waybills in one API call.
 * Returns a map of { waybill -> parsedPackage } for all found packages.
 *
 * @param {string[]} waybills
 * @param {object} config
 * @returns {Promise<Map<string, object>>}
 */
export async function fetchDelhiveryTracking(waybills, config) {
  if (!waybills.length) return new Map();

  const url = new URL(config.delhivery.trackingApiUrl);
  url.searchParams.set('waybill', waybills.join(','));
  url.searchParams.set('verbose', '1');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Token ${config.delhivery.token}`,
      Accept: 'application/json'
    }
  });

  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(
      `Delhivery tracking API failed (${response.status}): ${JSON.stringify(body)}`
    );
  }

  const packages = body?.ShipmentData || body?.shipment_data || [];
  const result = new Map();

  for (const entry of packages) {
    const pkg = entry?.Shipment || entry?.shipment || entry;
    const waybill =
      pkg?.Waybill || pkg?.waybill || pkg?.AWB || pkg?.awb || '';
    if (waybill) {
      result.set(waybill, pkg);
      result.set(normalizeWaybillKey(waybill), pkg);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

/**
 * Map a Delhivery status string to our internal shipment status.
 *
 * Delhivery statuses (from their API / scan events):
 *   Manifested, In Transit, Out For Delivery, Delivered,
 *   RTO Initiated, RTO In Transit, RTO Delivered,
 *   Failed Delivery, Pickup Error, Cancelled, Lost
 *
 * @param {string} delhiveryStatus
 * @returns {string}
 */
export function normalizeDelhiveryStatus(delhiveryStatus) {
  const s = String(delhiveryStatus || '').toLowerCase().trim();

  if (s.startsWith('rto')) return 'rto';
  if (s.includes('delivered')) return 'delivered';
  if (s.includes('out for delivery')) return 'out-for-delivery';
  if (s.includes('in transit') || s === 'intransit') return 'in-transit';
  if (s.includes('dispatched')) return 'dispatched';
  if (s.includes('picked up') || s === 'pickup') return 'picked-up';
  if (s.includes('manifested') || s === 'booked') return 'booked';
  if (
    s.includes('failed delivery') ||
    s.includes('pickup error') ||
    s.includes('cancelled') ||
    s.includes('lost')
  )
    return 'failed';

  // For any other unrecognised status, keep as in-transit so it stays active
  return 'in-transit';
}

/**
 * Extract all scan events from a Delhivery package object as normalised rows
 * ready to insert into `shipment_events`.
 *
 * @param {object} pkg  The package object from Delhivery tracking API
 * @returns {Array<{event_status, normalized_status, carrier_location, message, occurred_at, raw_event}>}
 */
export function extractTrackingEvents(pkg) {
  const scans = pkg?.Scans || pkg?.scans || [];
  const events = [];

  for (const scan of scans) {
    const scanDetail = scan?.ScanDetail || scan?.scanDetail || scan;
    const status =
      scanDetail?.Scan || scanDetail?.scan || scanDetail?.Status || scanDetail?.status || '';
    const location =
      scanDetail?.ScannedLocation || scanDetail?.scannedLocation || scanDetail?.Location || '';
    const message =
      scanDetail?.Instructions || scanDetail?.instructions || scanDetail?.StatusDateTime || '';
    const rawTime =
      scanDetail?.ScanDateTime || scanDetail?.scanDateTime || scanDetail?.StatusDateTime || '';

    const occurredAt = parseDateTime(rawTime);

    events.push({
      event_status: status,
      normalized_status: normalizeDelhiveryStatus(status),
      carrier_location: location || null,
      message: message || null,
      occurred_at: occurredAt,
      raw_event: scanDetail
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Background sync controller
// ---------------------------------------------------------------------------

/**
 * Create the tracking sync controller.  Same API pattern as `wixOrderSync.js`.
 *
 * @param {object} config  App config from `getConfig()`
 * @param {object} [options]
 * @returns {{ run, start, stop, snapshot }}
 */
export function createDelhiveryTrackingSync(config, options = {}) {
  const logger = options.logger || console;
  const setTimer = options.setTimer || setInterval;
  const clearTimer = options.clearTimer || clearInterval;
  let timer = null;

  const state = {
    enabled: Boolean(config.delhivery.trackingEnabled || config.shiprocket?.trackingEnabled || config.fedex?.trackingEnabled),
    running: false,
    lastReason: '',
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastPolled: 0,   // shipments checked
    lastUpdated: 0,  // shipments whose status changed
    lastEvents: 0,   // new scan events saved
    nextRunAt: null
  };

  async function run(reason = 'manual') {
    if (!state.enabled) return { skipped: true, reason: 'disabled', ...snapshot() };
    if (state.running) return { skipped: true, reason: 'already-running', ...snapshot() };
    if (config.delhivery.trackingEnabled && !config.delhivery.token) return failSkip('missing-delhivery-token');
    if (
      config.shiprocket?.trackingEnabled &&
      !config.shiprocket.token &&
      (!config.shiprocket.email || !config.shiprocket.password)
    ) {
      return failSkip('missing-shiprocket-credentials');
    }
    if (
      config.fedex?.trackingEnabled &&
      !config.fedex.clientId &&
      !config.fedex.clientSecret
    ) {
      return failSkip('missing-fedex-credentials');
    }
    if (!isSupabaseConfigured(config)) return failSkip('missing-supabase-config');

    state.running = true;
    state.lastReason = reason;
    state.lastStartedAt = new Date().toISOString();
    state.lastError = null;
    state.lastPolled = 0;
    state.lastUpdated = 0;
    state.lastEvents = 0;

    try {
      await runTrackingPass(config, state, logger);
    } catch (error) {
      state.lastError = error.message;
      logger.error?.(`Delhivery tracking sync failed: ${error.message}`);
    } finally {
      state.running = false;
      state.lastFinishedAt = new Date().toISOString();
      state.nextRunAt = nextRunTimestamp(config);
    }

    return snapshot();
  }

  function start() {
    if (!state.enabled) return snapshot();
    if (timer) return snapshot();

    state.nextRunAt = nextRunTimestamp(config, 10_000);
    // Small startup delay so the server is ready before first poll
    setTimeout(() => run('startup'), 10_000);
    timer = setTimer(() => run('interval'), config.delhivery.trackingIntervalMs);
    timer.unref?.();

    logger.log?.(
      `Tracking sync enabled: every ${Math.round(
        config.delhivery.trackingIntervalMs / 60_000
      )} min, Delhivery batch size ${config.delhivery.trackingBatchSize}, Shiprocket batch size ${config.shiprocket?.trackingBatchSize || 10}, FedEx batch size ${config.fedex?.trackingBatchSize || 10}`
    );
    return snapshot();
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
    state.nextRunAt = null;
    return snapshot();
  }

  function snapshot() {
    return { ...state };
  }

  function failSkip(reason) {
    state.lastError = reason;
    return { skipped: true, reason, ...snapshot() };
  }

  return { run, start, stop, snapshot };
}

// ---------------------------------------------------------------------------
// Core tracking pass
// ---------------------------------------------------------------------------

async function runTrackingPass(config, state, logger) {
  const activeShipments = await listActiveShipmentWaybills();
  if (!activeShipments.length) return;

  const shipmentsByCourier = groupShipmentsByCourier(activeShipments);
  await pollCourierTracking('delhivery', shipmentsByCourier.get('delhivery') || [], config.delhivery.trackingBatchSize, config, state, logger);
  await pollCourierTracking('shiprocket', shipmentsByCourier.get('shiprocket') || [], config.shiprocket?.trackingBatchSize || 10, config, state, logger);
  await pollCourierTracking('fedex', shipmentsByCourier.get('fedex') || [], config.fedex?.trackingBatchSize || 10, config, state, logger);
}

async function pollCourierTracking(courierCode, activeShipments, batchSize, config, state, logger) {
  if (!activeShipments.length || !isCourierTrackingEnabled(courierCode, config)) return;

  for (let offset = 0; offset < activeShipments.length; offset += batchSize) {
    const batch = activeShipments.slice(offset, offset + batchSize);
    const waybills = batch.map(s => s.waybill);

    let trackingMap;
    try {
      trackingMap = await fetchCourierTracking(courierCode, waybills, config);
    } catch (error) {
      logger.error?.(`${courierCode} tracking batch failed: ${error.message}`);
      continue; // skip this batch, try the next
    }

    for (const shipment of batch) {
      state.lastPolled += 1;
      const pkg = trackingMap.get(shipment.waybill) || trackingMap.get(normalizeWaybillKey(shipment.waybill));
      if (!pkg) continue;

      const liveStatus = normalizeCourierStatus(courierCode, getCourierLiveStatus(courierCode, pkg));
      const location = getCourierLiveLocation(courierCode, pkg);

      // Extract and save new scan events
      const events = extractCourierTrackingEvents(courierCode, pkg);
      const savedEvents = await saveTrackingEvents(shipment.id, events);
      state.lastEvents += savedEvents;

      // Update shipment status only if it changed and is a progression
      if (liveStatus && shouldUpdateStatus(shipment.status, liveStatus)) {
        await updateShipmentTracking(shipment.id, {
          status: liveStatus,
          location: location || null,
          lastEventAt: new Date().toISOString()
        });
        state.lastUpdated += 1;
        logger.log?.(
          `[tracking] ${courierCode} AWB ${shipment.waybill}: ${shipment.status} → ${liveStatus}${location ? ` (${location})` : ''}`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Status progression order — only move forward, never backward.
 * (e.g. don't overwrite 'delivered' with 'in-transit' from a stale scan)
 */
const STATUS_ORDER = [
  'booked',
  'picked-up',
  'dispatched',
  'in-transit',
  'out-for-delivery',
  'delivered',
  'rto',
  'failed'
];

export function groupShipmentsByCourier(shipments) {
  const grouped = new Map();
  for (const shipment of shipments) {
    const courierCode = courierCodeForTracking(shipment);
    if (!grouped.has(courierCode)) grouped.set(courierCode, []);
    grouped.get(courierCode).push(shipment);
  }
  return grouped;
}

export function courierCodeForTracking(shipment) {
  if (isDelhiveryInternationalWaybill(shipment?.waybill)) return 'delhivery';
  return shipment?.courier_code || 'delhivery';
}

export function isDelhiveryInternationalWaybill(waybill) {
  return /^DL[A-Z0-9]+CN$/i.test(String(waybill || '').trim());
}

function normalizeWaybillKey(waybill) {
  return String(waybill || '').trim().toUpperCase();
}

function isCourierTrackingEnabled(courierCode, config) {
  if (courierCode === 'fedex') return Boolean(config.fedex?.trackingEnabled);
  if (courierCode === 'shiprocket') return Boolean(config.shiprocket?.trackingEnabled);
  return Boolean(config.delhivery.trackingEnabled);
}

function fetchCourierTracking(courierCode, waybills, config) {
  if (courierCode === 'fedex') return fetchFedexTracking(waybills, config);
  if (courierCode === 'shiprocket') return fetchShiprocketTracking(waybills, config);
  return fetchDelhiveryTracking(waybills, config);
}

function normalizeCourierStatus(courierCode, rawStatus) {
  if (courierCode === 'fedex') return normalizeFedexStatus(rawStatus);
  if (courierCode === 'shiprocket') return normalizeShiprocketStatus(rawStatus);
  return normalizeDelhiveryStatus(rawStatus);
}

function getCourierLiveStatus(courierCode, pkg) {
  if (courierCode === 'fedex') return getFedexLiveStatus(pkg);
  if (courierCode === 'shiprocket') return getShiprocketLiveStatus(pkg);
  return (
    pkg?.Status?.Status ||
    pkg?.status?.Status ||
    pkg?.Status?.status ||
    pkg?.CurrentStatus ||
    pkg?.currentStatus ||
    ''
  );
}

function getCourierLiveLocation(courierCode, pkg) {
  if (courierCode === 'fedex') return getFedexLiveLocation(pkg);
  if (courierCode === 'shiprocket') return getShiprocketLiveLocation(pkg);
  return (
    pkg?.Status?.Instructions ||
    pkg?.Status?.ScannedLocation ||
    pkg?.status?.ScannedLocation ||
    pkg?.CurrentLocation ||
    ''
  );
}

function extractCourierTrackingEvents(courierCode, pkg) {
  if (courierCode === 'fedex') return extractFedexTrackingEvents(pkg);
  if (courierCode === 'shiprocket') return extractShiprocketTrackingEvents(pkg);
  return extractTrackingEvents(pkg);
}

function shouldUpdateStatus(current, next) {
  if (!next || current === next) return false;
  // Terminal states — don't overwrite
  if (['delivered', 'rto', 'failed'].includes(current)) return false;
  const currentRank = STATUS_ORDER.indexOf(current);
  const nextRank = STATUS_ORDER.indexOf(next);
  // Allow update if next is further along, or if next is a special terminal state
  if (nextRank === -1) return true; // unknown next, still allow
  if (currentRank === -1) return true; // unknown current, allow
  return nextRank > currentRank;
}

function parseDateTime(value) {
  if (!value) return new Date().toISOString();
  // Delhivery timestamps vary: "2024-03-15 10:30:00", "2024-03-15T10:30:00"
  try {
    const d = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function nextRunTimestamp(config, delayMs = config.delhivery.trackingIntervalMs) {
  return new Date(Date.now() + delayMs).toISOString();
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
