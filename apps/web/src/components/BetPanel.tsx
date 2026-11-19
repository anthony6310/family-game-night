import { MIN_STAKE, type Bet, type Player } from '@fgn/shared';

interface Props {
  /** The players this round: the names a spectator can bet on (in a team game: the two teams, with the team ids as ids). */
  players: Player[];
  /** A team game: the bet is on a team, not a player. */
  teams?: boolean;
  /** My bet right now (the server's copy), or undefined if I have none. */
  bet: Bet | undefined;
  /** My victory points: the most I can put up on top of the free bet. */
  points: number;
  /** Place, change or (target null) take back my bet. */
  onBet: (targetId: string | null, stake: number) => void;
}

/**
 * What a spectator sees in the ready step: the list of playing players to bet on (none picked to start with) and a plus/minus
 * to put up victory points of their own. A bet with no points put up wins 1 point and can't lose any; a bet with points put up wins
 * exactly that many, or loses exactly that many. Betting is
 * optional: ready up with nothing picked to just watch. The server owns the bet: every tap here sends it, and the screen shows
 * what comes back. (Changing a bet drops your Ready, so you ready up again with the bet you want.)
 */
export function BetPanel({ players, bet, points, onBet, teams = false }: Props) {
  const stake = bet?.stake ?? 0;
  return (
    <section className="bet-panel" aria-label="Bet on the winner">
      <h2 className="step-title">Bet on the winner?</h2>
      <p className="muted">Pick a {teams ? 'team' : 'player'}. If {teams ? 'it wins' : 'they win'} you get 1 point. Or put up some of your own points (at least {MIN_STAKE}): win or lose exactly that many.</p>
      <div className="bet-options" role="radiogroup" aria-label="Player to bet on">
        {players.map((p) => (
          <button key={p.id} role="radio" aria-checked={bet?.targetId === p.id}
            className={bet?.targetId === p.id ? 'choice selected' : 'choice'}
            // Tapping the picked name again takes the bet back.
            onClick={() => onBet(bet?.targetId === p.id ? null : p.id, stake <= points ? stake : 0)}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="stepper" aria-label="Extra points to bet">
        {/* A stake is 0 (a free bet) or at least MIN_STAKE: the buttons jump between the two. */}
        <button aria-label="One less point" disabled={!bet || stake <= 0} onClick={() => bet && onBet(bet.targetId, stake <= MIN_STAKE ? 0 : stake - 1)}>−</button>
        <span className="stepper-value"><strong>{stake}</strong> of your points</span>
        <button aria-label="One more point" disabled={!bet || (stake === 0 ? points < MIN_STAKE : stake >= points)} onClick={() => bet && onBet(bet.targetId, stake === 0 ? MIN_STAKE : stake + 1)}>+</button>
      </div>
      <p className="muted">
        You have 🏆 {points}.{' '}
        {bet ? `Win: +${Math.max(1, stake)} · Lose: ${stake > 0 ? `−${stake}` : 'nothing'}` : 'No bet: just watching.'}
      </p>
    </section>
  );
}
