/**
 * Proves the MVP 1 security rules with two throwaway users:
 *   npm run test:rls -w @fgn/server
 * Uses the admin (secret) client only to create/delete users; every assertion runs as a
 * normal signed-in user with the publishable key, i.e. exactly what a browser can do.
 */
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SUPABASE_PUBLISHABLE_KEY: pub } = process.env;
if (!url || !secret || !pub) throw new Error('Missing Supabase env vars in apps/server/.env');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let failures = 0;
function check(name: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

async function makeUser(label: string) {
  const email = `rls-${label}-${Date.now()}@example.com`;
  const password = 'Test-pass-1234';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url!, pub!, opts);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

const a = await makeUser('a');
const b = await makeUser('b');
try {
  // The signup trigger should have created an empty profile for each user.
  const { data: rows } = await admin.from('profiles').select('id, display_name').in('id', [a.id, b.id]);
  check('signup trigger created a profile for each user', rows?.length === 2 && rows.every((r) => r.display_name === null));

  const own = await a.client.from('profiles').update({ display_name: 'Alice', avatar_url: '/avatars/fox.svg' }).eq('id', a.id).select();
  check('A can update A\'s own profile', own.data?.length === 1);

  // RLS hides other rows from UPDATE: it "succeeds" but touches 0 rows. Confirm B is unchanged.
  const other = await a.client.from('profiles').update({ display_name: 'HACKED' }).eq('id', b.id).select();
  const { data: bRow } = await admin.from('profiles').select('display_name').eq('id', b.id).single();
  check('A cannot update B\'s profile', other.data?.length === 0 && bRow?.display_name === null);

  const forged = await a.client.from('profiles').insert({ id: b.id, display_name: 'forged' });
  check('A cannot insert a profile row for B', forged.error !== null);

  const read = await a.client.from('profiles').select('id').eq('id', b.id);
  check('A can read B\'s profile (profiles are shared)', read.data?.length === 1);

  const anon = await createClient(url, pub, opts).from('profiles').select('id');
  check('logged-out visitors read no profiles', (anon.data?.length ?? 0) === 0);

  const okUpload = await a.client.storage.from('avatars').upload(`${a.id}/avatar`, png, { contentType: 'image/png', upsert: true });
  check('A can upload into A\'s own folder', okUpload.error === null);

  const badUpload = await a.client.storage.from('avatars').upload(`${b.id}/avatar`, png, { contentType: 'image/png', upsert: true });
  check('A cannot upload into B\'s folder', badUpload.error !== null);

  const badType = await a.client.storage.from('avatars').upload(`${a.id}/evil.html`, Buffer.from('<script>'), { contentType: 'text/html' });
  check('non-image uploads are rejected', badType.error !== null);
} finally {
  // Clean up: files first, then users (profiles cascade-delete with the auth user).
  await admin.storage.from('avatars').remove([`${a.id}/avatar`, `${b.id}/avatar`]);
  await admin.auth.admin.deleteUser(a.id);
  await admin.auth.admin.deleteUser(b.id);
}
console.log(failures === 0 ? '\nAll RLS checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
