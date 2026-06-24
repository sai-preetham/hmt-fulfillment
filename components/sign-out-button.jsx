'use client';

import { createClient } from '@supabase/supabase-js';
import { LogOut } from 'lucide-react';

export function SignOutButton() {
  async function handleSignOut() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) { window.location.href = '/login'; return; }
    const supabase = createClient(url, key);
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <button
      onClick={handleSignOut}
      className="navItem"
      style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', marginTop: 'auto' }}
      aria-label="Sign out"
    >
      <LogOut size={17} aria-hidden="true" />
      <span>Sign out</span>
    </button>
  );
}
