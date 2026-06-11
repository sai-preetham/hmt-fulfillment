import { getConfig } from '../src/config.js';
import { isSupabaseConfigured, SupabaseRestClient } from '../src/supabase.js';

async function testConnection() {
  const config = getConfig();
  console.log('Supabase Configured:', isSupabaseConfigured(config));
  if (!isSupabaseConfigured(config)) {
    console.log('Supabase url or service role key is missing in config.');
    return;
  }
  console.log('Database URL:', config.supabase.url);
  try {
    const client = new SupabaseRestClient(config);
    const result = await client.select('staff_users', 'limit=1');
    console.log('Database connection successful. Staff users:', result);
  } catch (error) {
    console.error('Database connection failed:', error.message);
  }
}

testConnection();
