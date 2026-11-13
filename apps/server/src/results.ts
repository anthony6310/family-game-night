import type { RoundRecord, SessionRecord } from './rooms';
import { supabaseAdmin } from './supabase';

/**
 * Database saving. Uses the admin client because no browser is allowed to write scores.
 * A database hiccup must never break a live game, so failures are only logged.
 */
export async function saveRound({ roomCode, gameType, winner }: RoundRecord): Promise<void> {
  const { error } = await supabaseAdmin.from('game_results').insert({
    room_code: roomCode,
    game_type: gameType,
    winner_profile_id: winner.isGuest ? null : winner.id, // guests have no profile row
    winner_name: winner.name,
    is_guest: winner.isGuest,
    is_tiebreaker: false,
  });
  if (error) console.error('Could not save round result:', error.message);
}

/** One row per finished session: the permanent "who won" record. */
export async function saveSession({ roomCode, winner, winnerWins, roundsPlayed }: SessionRecord): Promise<void> {
  const { error } = await supabaseAdmin.from('session_results').insert({
    room_code: roomCode,
    winner_profile_id: winner.isGuest ? null : winner.id,
    winner_name: winner.name,
    is_guest: winner.isGuest,
    winner_wins: winnerWins,
    total_rounds: roundsPlayed,
    tiebreaker_rounds: 0,
  });
  if (error) console.error('Could not save session result:', error.message);
}
