import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY in apps/server/.env');

/**
 * Admin client for the server only. The secret key BYPASSES Row-Level Security,
 * which is how the server writes scores that no phone is allowed to write.
 * Never send this key (or this client) to the browser.
 */
export const supabaseAdmin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false }, // no user session on a server
});

/** Connection check: an admin-only call only succeeds with a valid URL and secret key. */
export async function checkSupabase(): Promise<boolean> {
  const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}
