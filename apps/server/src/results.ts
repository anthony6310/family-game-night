import type { RoundRecord } from './rooms';
import { supabaseAdmin } from './supabase';

/**
 * Saves a decided round to `game_results`. Uses the admin client because no browser is allowed
 * to write scores. A database hiccup must never break a live game, so failures are only logged.
 */
export async function saveRound({ roomCode, gameType, winner }: RoundRecord): Promise<void> {
  const { error } = await supabaseAdmin.from('game_results').insert({
    room_code: roomCode,
    game_type: gameType,
    winner_profile_id: winner.isGuest ? null : winner.id, // guests have no profile row
    winner_name: winner.name,
    is_guest: winner.isGuest,
  });
  if (error) console.error('Could not save round result:', error.message);
}
