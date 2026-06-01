export function isSupabaseConfigured(config) {
  return Boolean(config.supabase?.url && config.supabase?.serviceRoleKey);
}

export class SupabaseRestClient {
  constructor(config) {
    this.url = config.supabase.url.replace(/\/$/, '');
    this.key = config.supabase.serviceRoleKey;
  }

  async select(table, query = '') {
    return this.request(table, {
      method: 'GET',
      query
    });
  }

  async insert(table, row) {
    const rows = await this.request(table, {
      method: 'POST',
      body: row,
      headers: { Prefer: 'return=representation' }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async upsert(table, row, conflictTarget) {
    const query = conflictTarget ? `on_conflict=${encodeURIComponent(conflictTarget)}` : '';
    const rows = await this.request(table, {
      method: 'POST',
      query,
      body: row,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async patch(table, query, row) {
    const rows = await this.request(table, {
      method: 'PATCH',
      query,
      body: row,
      headers: { Prefer: 'return=representation' }
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async request(table, { method, query = '', body, headers = {} }) {
    const separator = query ? `?${query}` : '';
    const response = await fetch(`${this.url}/rest/v1/${table}${separator}`, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`Supabase ${method} ${table} failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    return payload;
  }
}
