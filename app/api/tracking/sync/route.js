import { NextResponse } from 'next/server';
import { automationUnauthorizedResponse, isAuthorizedAutomationRequest } from '@/lib/crm/automation-auth';
import { applyCrmSettingsToConfig } from '@/lib/crm/settings';
import { createServiceClient } from '@/lib/supabase/server';
import { getConfig } from '@/src/config.js';
import { createDelhiveryTrackingSync } from '@/src/delhiveryTracking.js';

export async function POST(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();

  const config = applyCrmSettingsToConfig(getConfig(), await loadSettings());
  const sync = createDelhiveryTrackingSync(
    {
      ...config,
      delhivery: {
        ...config.delhivery,
        trackingEnabled: true
      }
    },
    {
      setTimer: () => null,
      clearTimer: () => null
    }
  );

  const tracking = await sync.run('api');
  return NextResponse.json({ ok: !tracking.lastError, tracking }, { status: tracking.lastError ? 500 : 200 });
}

export async function GET(request) {
  if (!isAuthorizedAutomationRequest(request)) return automationUnauthorizedResponse();
  const config = applyCrmSettingsToConfig(getConfig(), await loadSettings());
  return NextResponse.json({
    ok: true,
    tracking: {
      delhiveryEnabled: true,
      shiprocketEnabled: Boolean(config.shiprocket?.trackingEnabled),
      fedexEnabled: Boolean(config.fedex?.trackingEnabled),
      intervalMinutes: Math.round((config.delhivery.trackingIntervalMs || 0) / 60_000),
      batchSize: config.delhivery.trackingBatchSize
    }
  });
}

async function loadSettings() {
  const supabase = createServiceClient();
  if (!supabase) return {};
  const { data, error } = await supabase.from('crm_settings').select('key,value');
  if (error) return {};
  return (data || []).reduce((settings, row) => ({ ...settings, [row.key]: row.value }), {});
}
