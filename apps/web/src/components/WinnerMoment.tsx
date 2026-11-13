import { useEffect, useRef } from 'react';
import { WINNER_SECONDS, type RoundResult } from '@fgn/shared';
import { audio } from '../audio/spatialAudio';
import { drawChime, drumrollFor, victoryFanfare } from '../audio/gameSounds';

/**
 * THE winner moment shared by games that end with the camera panning to the winner (an ongoing rule: see GAME_RULES.md #2).
 * `true` during the last WINNER_SECONDS of the finish sequence: the game screen then points EVERY player's camera at the winner
 * (`result.winnerId`; on a draw, nobody) and shows <WinnerBanner>. Before that, for the first part of the finish sequence, each
 * player simply keeps looking at their own view with no result shown.
 */
export function isWinnerMoment(frozen: boolean, result: RoundResult | null, finishEndsAt: number | null, serverNow: () => number): boolean {
  return frozen && result !== null && finishEndsAt !== null && finishEndsAt - serverNow() <= WINNER_SECONDS * 1000;
}

/** "The winner is X" (or "It's a draw!"), big and centred near the top of the game view. */
export function WinnerBanner({ result }: { result: RoundResult }) {
  return (
    <div className="winner-banner" role="status">
      {result.winner ? (
        <>
          <span>The winner is</span>
          <strong>{result.winner.name}</strong>
        </>
      ) : (
        <strong>It's a draw!</strong>
      )}
    </div>
  );
}

/**
 * The sound of the winner sequence, the same in every game: a DRUMROLL starts the moment the round freezes and keeps building,
 * and as the camera reaches the winner it crescendos into a VICTORY FANFARE (a draw gets a soft chime instead). Everything is
 * scheduled ahead on the audio clock at the moment the round freezes, so the fanfare lands right as the banner appears. It is
 * heard equally by everyone (players and spectators), follows the sound on/off setting, and only plays when you SEE the round
 * end (joining during the sequence stays silent). Call it once from the game screen.
 */
export function useWinnerSounds(frozen: boolean, result: RoundResult | null, finishEndsAt: number | null, serverNow: () => number) {
  const wasFrozen = useRef(frozen); // starts as it is now: arriving already frozen makes no noise
  useEffect(() => {
    if (frozen && !wasFrozen.current && result && finishEndsAt !== null) {
      const untilWinner = Math.max(0.4, (finishEndsAt - serverNow() - WINNER_SECONDS * 1000) / 1000); // seconds until the camera starts to pan
      const roll = untilWinner + 0.45; // the roll peaks just after the pan begins, and the fanfare lands on its last stroke
      audio.playFlat(drumrollFor(roll), 0.65);
      audio.playFlat(result.winner ? victoryFanfare : drawChime, 0.7, roll);
    }
    wasFrozen.current = frozen;
  }, [frozen, result, finishEndsAt, serverNow]);
}
