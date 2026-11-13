import { WINNER_SECONDS, type RoundResult } from '@fgn/shared';

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
