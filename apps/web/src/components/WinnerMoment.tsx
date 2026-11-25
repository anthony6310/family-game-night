import { useEffect, useRef } from 'react';
import { TEAM_COLORS, TEAM_NAMES, WINNER_SECONDS, type Player, type RoundResult } from '@fgn/shared';
import { audio } from '../audio/spatialAudio';
import { Icon } from './Icon';
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

/**
 * How big a victory-point number is drawn, as a multiple of its normal size: the more points won, the bigger it looks (the same
 * idea as Tap Race's count growing with every tap). 1 point is normal size, it grows quickly at first (6 points is about 1.9x)
 * and levels off towards about 2.4x, so a huge win is big without taking over the screen.
 */
export function vpScale(points: number): number {
  return 1 + 1.4 * (1 - Math.exp(-(Math.max(1, points) - 1) / 6));
}

const MAX_BETTORS_SHOWN = 10; // a big room could have many winning bettors: show the biggest wins and count the rest

/**
 * "The winner is X +1" (or "It's a draw!"), big and centred near the top of the game view.
 * - If the underdog won (outright, or because they were tied for first in a draw) a line under the name says so and shows the
 *   bonus they collected, drawn bigger the more it is.
 * - If spectators bet on the winner, the heading becomes "The winners are" and the winning bettors are listed underneath in a
 *   smaller font, each with what they won (1 for a free bet, or the points they put up), the number growing with the amount.
 *   (Nobody's bets are shown otherwise: only who won, and how much.)
 * With neither (for instance a game with no spectators) it stays "The winner is". `players` is where the bettors' names come from.
 */
export function WinnerBanner({ result, players }: { result: RoundResult; players: Player[] }) {
  // A dark see-through layer over the game (about 40%), so the text is easy to read while the game still shows through behind it.
  const backdrop = <div className="winner-backdrop" aria-hidden="true" />;
  // A TEAM game: the camera is panned right out and the banner names the winning team (every member of it won a point), with the winning bettors as usual.
  if (result.team && result.team.winner) {
    const team = result.team.winner;
    const teamNames = new Map(players.map((p) => [p.id, p.name]));
    const bettors = result.winningBettors.filter((b) => b.delta > 0 && teamNames.has(b.bettorId)).sort((a, b) => b.delta - a.delta).slice(0, MAX_BETTORS_SHOWN);
    return (
      <>
        {backdrop}
        <div className="winner-banner" role="status">
          <span>{bettors.length > 0 ? 'The winners are' : 'The winner is'}</span>
          <strong style={{ color: TEAM_COLORS[team] }}>
            {result.team.names?.[team] ?? TEAM_NAMES[team]}
            <em className="winner-vp" style={{ fontSize: `${0.5 * vpScale(1)}em`, color: '#fff' }}>+1 each</em>
          </strong>
          <p className="winner-underdog">{result.team.members[team].map((id) => teamNames.get(id) ?? 'a player').join(' · ')}</p>
          {bettors.length > 0 && (
            <ul className="winner-bettors" aria-label="Winning bets">
              {bettors.map((b) => (
                <li key={b.bettorId}>{teamNames.get(b.bettorId)}<em className="winner-vp" style={{ fontSize: `${vpScale(b.delta)}em` }}>+{b.delta}</em></li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }
  if (!result.winner) {
    return (
      <>
        {backdrop}
        <div className="winner-banner" role="status">
          <strong>It's a draw!</strong>
        </div>
      </>
    );
  }
  const names = new Map(players.map((p) => [p.id, p.name]));
  const winningBettors = result.winningBettors
    .filter((b) => b.delta > 0 && names.has(b.bettorId))
    .sort((a, b) => b.delta - a.delta);
  const shown = winningBettors.slice(0, MAX_BETTORS_SHOWN);
  const plural = winningBettors.length > 0; // the round's winner plus at least one winning bettor
  const underdog = result.underdog;
  return (
    <>
    {backdrop}
    <div className="winner-banner" role="status">
      <span>{plural ? 'The winners are' : 'The winner is'}</span>
      <strong>
        {result.winner.name}
        <em className="winner-vp" style={{ fontSize: `${0.5 * vpScale(1)}em` }}>+1</em>
      </strong>
      {underdog && (
        <p className="winner-underdog">
          <Icon name="alert" /> {underdog.byDraw ? 'The underdog wins the draw!' : 'The underdog wins!'}
          {underdog.bonus > 0 && <em className="winner-vp" style={{ fontSize: `${vpScale(underdog.bonus)}em` }}>+{underdog.bonus}</em>}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="winner-bettors" aria-label="Winning bets">
          {shown.map((b) => (
            <li key={b.bettorId}>
              {names.get(b.bettorId)}
              <em className="winner-vp" style={{ fontSize: `${vpScale(b.delta)}em` }}>+{b.delta}</em>
            </li>
          ))}
          {winningBettors.length > shown.length && <li className="more">+{winningBettors.length - shown.length} more</li>}
        </ul>
      )}
    </div>
    </>
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
