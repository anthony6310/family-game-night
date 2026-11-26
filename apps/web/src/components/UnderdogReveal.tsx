import { useEffect } from 'react';
import { UNDERDOG_SECONDS, type Player, type Underdog } from '@fgn/shared';
import { audio } from '../audio/spatialAudio';
import { siren } from '../audio/gameSounds';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { vpScale } from './WinnerMoment';

interface Props {
  underdog: Underdog;
  players: Player[];
  /** Server clock when the announcement ends and the round starts (used so someone arriving late doesn't hear the whole siren). */
  endsAt: number;
  serverNow: () => number;
}

/**
 * The underdog announcement (GAME_RULES.md #5): a full-screen moment, shown to EVERYONE in the room between the countdown and the
 * start of the round, naming the one player nobody bet on and what they win if they win. It reveals only that and the payout,
 * never who bet on whom. A siren sounds (it follows the sound on/off setting) and a red glow pulses gently (not a strobe; it
 * stops entirely for people who ask their device for less motion).
 */
export function UnderdogReveal({ underdog, players, endsAt, serverNow }: Props) {
  const player = players.find((p) => p.id === underdog.playerId);
  // The siren plays once, as the announcement appears (not if you arrive with under a second to go).
  useEffect(() => {
    if (endsAt - serverNow() > (UNDERDOG_SECONDS - 1) * 1000) audio.playFlat(siren, 0.48); // (0.6 before: 20% quieter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const total = 1 + underdog.bonus; // the usual point for winning, plus 1 per person who bet against them

  return (
    <div className="underdog-screen" role="alert">
      <div className="underdog-glow" aria-hidden="true" />
      <p className="underdog-kicker"><Icon name="alert" /> Underdog alert <Icon name="alert" /></p>
      {player && <Avatar url={player.avatarUrl} name={player.name} size={110} />}
      <h1 className="underdog-name">{player?.name ?? 'A player'}</h1>
      <p className="underdog-line">Everyone else was bet on. Nobody backed them.</p>
      <p className="underdog-prize">
        If they win, they get
        <strong style={{ fontSize: `${vpScale(total)}em` }}>+{total}</strong>
        <span><Icon name="trophy" /> victory {total === 1 ? 'point' : 'points'}</span>
      </p>
      <p className="underdog-small">A draw that includes them counts as their win too.</p>
    </div>
  );
}
