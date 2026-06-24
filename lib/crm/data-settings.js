/**
 * CRM settings DB layer — reads/writes the `crm_settings` table via the
 * Supabase service client. Falls back to defaults if the table is missing.
 */
import { createServiceClient } from '@/lib/supabase/server';
import { mergeCrmSettings, settingsFromFormPayload, SETTINGS_KEYS } from './settings';

export async function getCrmSettings() {
  try {
    const supabase = createServiceClient();
    if (!supabase) return mergeCrmSettings([]);
    const { data, error } = await supabase
      .from('crm_settings')
      .select('key, value')
      .in('key', SETTINGS_KEYS);
    if (error) return mergeCrmSettings([]);
    return mergeCrmSettings(data || []);
  } catch {
    return mergeCrmSettings([]);
  }
}

export async function saveCrmSettings(payload = {}) {
  try {
    const supabase = createServiceClient();
    if (!supabase) return { ok: false, error: 'Supabase not configured.' };
    const settings = settingsFromFormPayload(payload);
    for (const key of SETTINGS_KEYS) {
      if (!(key in settings)) continue;
      await supabase
        .from('crm_settings')
        .upsert({ key, value: settings[key] }, { onConflict: 'key' });
    }
    return { ok: true, settings };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
