import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DISPLAY_NAME_MAX, type HandshakeAuth, type Player } from '@fgn/shared';
import { supabaseAdmin } from './supabase';

/** Thrown with a message that is safe to show to the player. */
export class AuthError extends Error {}

// Supabase publishes its public signing keys here. jose downloads and caches them, then uses
// them to check that a token's signature is genuine (no call to Supabase per connection).
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL!));
  return jwks;
}

// A guest's identity: `guest_<uuid>`, signed with a secret only the server knows, so the browser can keep it and prove it is the same guest after a refresh (and nobody can make one up).
// The secret is GUEST_TOKEN_SECRET if set, otherwise a random one made when the server starts (a restart then makes every old token invalid: guests simply get a new identity).
const guestSecret = process.env.GUEST_TOKEN_SECRET || randomBytes(32).toString('hex');
export function signGuestId(id: string): string {
  return `${id}.${createHmac('sha256', guestSecret).update(id).digest('base64url')}`;
}
/** The guest id inside a token, if the token is genuine; otherwise null. */
export function verifyGuestToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const id = token.slice(0, dot), given = Buffer.from(token.slice(dot + 1)), wanted = Buffer.from(createHmac('sha256', guestSecret).update(id).digest('base64url'));
  return /^guest_[0-9a-f-]{36}$/.test(id) && given.length === wanted.length && timingSafeEqual(given, wanted) ? id : null;
}

/**
 * Turns the handshake into a trusted Player.
 * - Account: verify the JWT, then load name/avatar from the DB (never trust the client for these).
 * - Guest: a trimmed name and an ephemeral id. Nothing is stored anywhere.
 */
export async function authenticate(auth: HandshakeAuth | undefined): Promise<Player> {
  if (typeof auth?.token === 'string') {
    let userId: string;
    try {
      const { payload } = await jwtVerify(auth.token, getJwks(), {
        issuer: `${process.env.SUPABASE_URL}/auth/v1`,
        audience: 'authenticated',
      });
      userId = payload.sub!;
    } catch {
      throw new AuthError('Invalid or expired login. Please log in again.');
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.display_name || !profile.avatar_url) throw new AuthError('Finish your profile first.');
    return { id: userId, name: profile.display_name, avatarUrl: profile.avatar_url, isGuest: false };
  }

  const name = typeof auth?.guestName === 'string' ? auth.guestName.trim() : '';
  if (!name || name.length > DISPLAY_NAME_MAX) throw new AuthError('Enter a name (1-20 characters).');
  return { id: verifyGuestToken(auth?.guestToken) ?? `guest_${randomUUID()}`, name, avatarUrl: null, isGuest: true }; // (a genuine token keeps the same identity across a refresh)
}
