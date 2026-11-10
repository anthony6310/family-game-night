import { randomUUID } from 'node:crypto';
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
  return { id: `guest_${randomUUID()}`, name, avatarUrl: null, isGuest: true };
}
