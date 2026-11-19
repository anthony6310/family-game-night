import { HANDICAP_MAX, TEAM_COLORS, TEAM_IDS, TEAM_NAMES, type Player, type RoomState, type TeamId } from '@fgn/shared';
import { Avatar } from './Avatar';

interface Props {
  room: RoomState;
  selfId: string | null;
  isHost: boolean;
  /** Players who are watching are not on a team (they bet on one instead). */
  watchingIds: string[];
  onPick: (team: TeamId) => void;
  onSwap: (allowed: boolean) => void;
  onHandicap: (team: TeamId, value: number) => void;
}

/**
 * The TEAM step of the lobby, shown before the ready step when the picked game is a team game (GAME_RULES.md #17): the two teams side by side with who is on each, a button to join a team
 * (while the host allows swapping), and for the HOST a switch for team swapping and a handicap for each team (a head start in the game's own score; the amount is up to the players).
 * Everyone else sees the handicaps too, so nobody starts under one they have not seen.
 */
export function TeamPanel({ room, selfId, isHost, watchingIds, onPick, onSwap, onHandicap }: Props) {
  const byId = new Map<string, Player>(room.players.map((p) => [p.id, p]));
  const playing = room.players.filter((p) => !watchingIds.includes(p.id));
  const members = (team: TeamId) => playing.filter((p) => room.teams[p.id] === team);
  const mine = selfId ? room.teams[selfId] : undefined;
  const canPick = room.settings.teamSwap && selfId !== null && !watchingIds.includes(selfId);
  const filled = TEAM_IDS.every((t) => members(t).length > 0);
  return (
    <section className="team-panel" aria-label="Teams">
      <h2 className="step-title">Teams</h2>
      <div className="team-columns">
        {TEAM_IDS.map((team) => {
          const value = room.settings.handicap[team];
          return (
            <div key={team} className={mine === team ? 'team-col mine' : 'team-col'} style={{ ['--team' as string]: TEAM_COLORS[team] }}>
              <h3 className="team-name">{TEAM_NAMES[team]}</h3>
              <ul className="team-members">
                {members(team).map((p) => (
                  <li key={p.id}><Avatar url={p.avatarUrl} name={p.name} size={28} /><span>{byId.get(p.id)?.name}{p.id === selfId && ' (you)'}</span></li>
                ))}
                {members(team).length === 0 && <li className="muted">nobody yet</li>}
              </ul>
              {/* The handicap: the host changes it; everyone sees it. */}
              <div className="team-handicap">
                {isHost ? (
                  <div className="stepper" aria-label={`${TEAM_NAMES[team]} handicap`}>
                    <button aria-label="Handicap down" disabled={value <= -HANDICAP_MAX} onClick={() => onHandicap(team, value - 1)}>−</button>
                    <span className="stepper-value">head start <strong>{value > 0 ? `+${value}` : value}</strong></span>
                    <button aria-label="Handicap up" disabled={value >= HANDICAP_MAX} onClick={() => onHandicap(team, value + 1)}>+</button>
                  </div>
                ) : value !== 0 ? <span className="muted">head start <strong>{value > 0 ? `+${value}` : value}</strong></span> : null}
              </div>
              {canPick && mine !== team && <button className="primary" onClick={() => onPick(team)}>Join {TEAM_NAMES[team]}</button>}
            </div>
          );
        })}
      </div>
      {isHost && (
        <label className="team-swap">
          <input type="checkbox" checked={room.settings.teamSwap} onChange={(e) => onSwap(e.target.checked)} /> Players can choose their team
        </label>
      )}
      {!isHost && !room.settings.teamSwap && <p className="muted">The host has locked the teams.</p>}
      {!filled && <p className="error">A team game needs at least one player on each team.</p>}
    </section>
  );
}
