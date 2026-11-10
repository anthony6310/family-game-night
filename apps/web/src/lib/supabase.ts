import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Fail loudly at startup instead of with confusing errors later.
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in apps/web/.env');

/**
 * Browser Supabase client. The publishable key is safe to ship to browsers:
 * what a user can actually do is limited by Row-Level Security in the database.
 */
export const supabase = createClient(url, key);

/** Connection check: asks Supabase Auth for its public settings. 200 = URL and key are valid. */
export async function checkSupabase(): Promise<boolean> {
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    return res.ok;
  } catch {
    return false;
  }
}
