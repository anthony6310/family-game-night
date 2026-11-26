import { TEAM_COLORS, getGame, type RoomState } from '@fgn/shared';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';

/**
 * Everyone in the room as a compact row of avatars: a tick for ready, a ring in their color (their TEAM's color in a team game), a crown for the host, dimmed if they are watching and "…" while
 * they are reconnecting. Tapping it opens the full list (Scores). It is how you see at a glance who the room is waiting for.
 */
export function PlayersStrip({ room, selfId, onOpen }: { room: RoomState; selfId: string | null; onOpen: () => void }) {
  const teamGame = getGame(room.settings.gameId)?.teams === true;
  return (
    <button className="players-strip" aria-label="Everyone in the room: tap for the list" onClick={onOpen}>
      {room.players.map((p) => {
        const watching = room.watchingIds.includes(p.id);
        const ring = teamGame && !watching && room.teams[p.id] ? TEAM_COLORS[room.teams[p.id]] : room.colors[p.id];
        return (
          <span key={p.id} className={watching ? 'strip-player watching' : 'strip-player'}>
            <span className="strip-avatar" style={{ borderColor: ring }}>
              <Avatar url={p.avatarUrl} name={p.name} size={40} />
              {room.readyIds.includes(p.id) && <span className="strip-ready" title="Ready"><Icon name="check" /></span>}
              {p.id === room.hostId && <span className="strip-host" title="Host"><Icon name="crown" /></span>}
              {room.offlineIds.includes(p.id) && <span className="strip-away" title="Reconnecting">…</span>}
            </span>
            <span className="strip-name">{p.id === selfId ? 'You' : p.name}</span>
          </span>
        );
      })}
    </button>
  );
}
