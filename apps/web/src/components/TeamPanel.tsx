import { useState } from 'react';
import { HANDICAP_MAX, TEAM_COLORS, TEAM_IDS, TEAM_NAMES, type Player, type RoomState, type TeamId } from '@fgn/shared';
import { Avatar } from './Avatar';

/**
 * The handicap control: a text box where any whole number can be typed (it is sent when you leave the box or press Enter; anything that is not a whole number within the limits goes back to what it was),
 * with - and + buttons for one step at a time.
 */
function HandicapInput({ team, value, onChange }: { team: TeamId; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim(), n = Number(text);
    if (text !== '' && Number.isInteger(n) && Math.abs(n) <= HANDICAP_MAX && n !== value) onChange(n);
    setDraft(null);
  };
  return (
    <div className="handicap" aria-label={`${TEAM_NAMES[team]} handicap`}>
      <span className="handicap-label">head start</span>
      <div className="handicap-row">
        <button aria-label="Handicap down" disabled={value <= -HANDICAP_MAX} onClick={() => onChange(value - 1)}>&minus;</button>
        <input inputMode="numeric" aria-label={`${TEAM_NAMES[team]} head start`} value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <button aria-label="Handicap up" disabled={value >= HANDICAP_MAX} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

interface Props {
  room: RoomState;
  selfId: string | null;
  isHost: boolean;
  /** Players who are watching are not on a team (they bet on one instead). */
  watchingIds: string[];
  onPick: (team: TeamId) => void;
  onSwap: (allowed: boolean) => void;
  onHandicap: (team: TeamId, value: number) => void;
  /** Leave out the panel's own heading (inside a sheet that already says Teams). */
  hideTitle?: boolean;
}

/**
 * The TEAM step of the lobby, shown before the ready step when the picked game is a team game (GAME_RULES.md #17): the two teams side by side with who is on each, a button to join a team
 * (while the host allows swapping), and for the HOST a switch for team swapping and a handicap for each team (a head start in the game's own score; the amount is up to the players).
 * Everyone else sees the handicaps too, so nobody starts under one they have not seen.
 */
export function TeamPanel({ room, selfId, isHost, watchingIds, onPick, onSwap, onHandicap, hideTitle = false }: Props) {
  const byId = new Map<string, Player>(room.players.map((p) => [p.id, p]));
  const playing = room.players.filter((p) => !watchingIds.includes(p.id));
  const members = (team: TeamId) => playing.filter((p) => room.teams[p.id] === team);
  const mine = selfId ? room.teams[selfId] : undefined;
  const canPick = room.settings.teamSwap && selfId !== null && !watchingIds.includes(selfId);
  const filled = TEAM_IDS.every((t) => members(t).length > 0);
  return (
    <section className="team-panel" aria-label="Teams">
      {!hideTitle && <h2 className="step-title">Teams</h2>}
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
                  <HandicapInput team={team} value={value} onChange={(v) => onHandicap(team, v)} />
                ) : value !== 0 ? <span className="muted">head start <strong>{value > 0 ? `+${value}` : value}</strong></span> : null}
              </div>
              {canPick && mine !== team && <button className="primary" onClick={() => onPick(team)}>Join {TEAM_NAMES[team]}</button>}
            </div>
          );
        })}
      </div>
      {isHost && (
        <label className="team-swap">
          <input type="checkbox" checked={room.settings.teamSwap} onChange={(e) => onSwap(e.target.checked)} />
          <span>Players can choose their team</span>
        </label>
      )}
      {!isHost && !room.settings.teamSwap && <p className="muted">The host has locked the teams.</p>}
      {!filled && <p className="error">A team game needs at least one player on each team.</p>}
    </section>
  );
}
