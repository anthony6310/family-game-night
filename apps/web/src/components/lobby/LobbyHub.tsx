import { useState } from 'react';
import { GAMES, MAX_PLAYERS, TEAM_IDS, TEAM_NAMES, getGame, type GameId, type Player, type RoomState } from '@fgn/shared';
import { Avatar } from '../Avatar';
import { BetPanel } from '../BetPanel';
import { ColorPicker } from '../ColorPicker';
import { Countdown } from '../Countdown';
import { Icon } from '../Icon';
import { RandomArt } from '../GameCarousel';
import { TeamPanel } from '../TeamPanel';
import { useRoom } from '../../room/RoomContext';
import { GameHero } from './GameHero';
import { PlayersStrip } from './PlayersStrip';
import { RoomSheet } from './RoomSheet';
import { Sheet } from './Sheet';

type SheetName = 'game' | 'team' | 'me' | 'scores' | 'room';

interface Props {
  room: RoomState;
  selfId: string | null;
  serverNow: () => number;
  error: string | null;
  images: Partial<Record<GameId, string>>;
  /** Fires a command and shows its error (if any). */
  run: (action: Promise<string | null>) => Promise<void>;
  onLeave: () => void;
}

/**
 * THE LOBBY HUB (GAME_RULES.md #19). The lobby has one job: get everyone to the Ready button. The main screen shows only what that needs: who is here (and ready), the picked game, a short
 * checklist of what is still needed (only the steps that apply to YOU and the game), the Ready button and a bottom bar. Everything else opens in a sheet over it: the Game menu (the picker),
 * Team (team games), Me (color, play or watch, and a spectator's bet), Scores (the full list and the wins) and Room (the host's settings; Leave).
 */
export function LobbyHub({ room, selfId, serverNow, error, images, run, onLeave, initialSheet = null }: Props & { initialSheet?: SheetName | null }) {
  const { updateSettings, setReady, setWatching, setColor, setTeam, setHandicap, placeBet, endSession, closeRoom } = useRoom();
  const [open, setOpen] = useState<SheetName | null>(initialSheet);
  const close = () => setOpen(null);

  const isHost = room.hostId === selfId;
  const game = getGame(room.settings.gameId);
  const watchingIds = room.watchingIds;
  const isWatcher = selfId !== null && watchingIds.includes(selfId);
  const spectatorOnly = selfId !== null && room.spectatorOnlyIds.includes(selfId); // beyond the first MAX_PLAYERS to join: no Play option
  const playing = room.players.filter((p) => !watchingIds.includes(p.id));
  const teamGame = game?.teams === true;
  const teamsFilled = TEAM_IDS.every((t) => playing.some((p) => room.teams[p.id] === t));
  const teamOptions: Player[] = TEAM_IDS.filter((t) => playing.some((p) => room.teams[p.id] === t)).map((t) => ({ id: t, name: TEAM_NAMES[t], avatarUrl: null, isGuest: true }));
  const amReady = selfId !== null && room.readyIds.includes(selfId);
  const waitingOn = room.players.filter((p) => !room.readyIds.includes(p.id)).length; // EVERYONE readies up, spectators too (they choose bets)
  const myPoints = selfId ? (room.scores[selfId] ?? 0) : 0;
  const myBet = selfId ? room.bets[selfId] : undefined;
  const hasGame = Boolean(game) || room.settings.random;

  // The status line explains exactly why the round hasn't started yet.
  let status = '';
  if (!hasGame) status = isHost ? 'Pick a game to get started.' : 'Waiting for the host to pick a game…';
  else if (game && playing.length < game.minPlayers) status = `Waiting for more players (need ${game.minPlayers}).`;
  else if (teamGame && !teamsFilled) status = 'A team game needs at least one player on each team.';
  else if (waitingOn > 0) status = `Waiting for ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'} to ready up…`;

  // The checklist: only the steps that still need something from me. The team chip (a team game and I am playing) opens the Teams menu; the Ready chip is just the state of my Ready.
  const showTeamChip = teamGame && !isWatcher;

  return (
    <main className="page hub">
      <header className="hub-head">
        <div className="hub-title">
          <h1 className="room-title">{room.hasPassword && <span title="This room has a password"><Icon name="lock" /> </span>}{room.name}</h1>
          <p className="muted">Round {room.roundsPlayed + 1} · {playing.length} playing{watchingIds.length > 0 && ` · ${watchingIds.length} watching`}</p>
        </div>
        <button className="hub-gear" aria-label="Room menu" onClick={() => setOpen('room')}><Icon name="sliders" /></button>
      </header>

      <PlayersStrip room={room} selfId={selfId} onOpen={() => setOpen('scores')} />

      <GameHero room={room} isHost={isHost} images={images} onChange={() => setOpen('game')} />

      <ul className="hub-steps" aria-label="What is left to do">
        {showTeamChip && (
          <li><button className={teamsFilled ? 'chip done' : 'chip'} onClick={() => setOpen('team')}>{teamsFilled ? <Icon name="check" /> : <span className="chip-dot" />} Team</button></li>
        )}
        <li><span className={amReady ? 'chip done' : 'chip'}>{amReady ? <Icon name="check" /> : <span className="chip-dot" />} Ready</span></li>
      </ul>

      {room.phase === 'countdown' && room.countdownEndsAt !== null && <Countdown endsAt={room.countdownEndsAt} serverNow={serverNow} />}
      {status && <p className="muted hub-status">{status}</p>}
      {error && <p className="error">{error}</p>}

      {/* A spectator's bet sits right above the Ready button (it is only here while you are watching). */}
      {isWatcher && (
        <BetPanel players={game?.teams ? teamOptions : playing} teams={teamGame} bet={myBet} points={myPoints} onBet={(target, stake) => run(placeBet(target, stake))} />
      )}

      <button className={amReady ? 'hub-ready' : 'primary hub-ready'} disabled={!hasGame} onClick={() => run(setReady(!amReady))}>
        {amReady ? 'Not ready' : "I'm ready!"}
      </button>

      <nav className="hub-bar" aria-label="Lobby menus">
        {isHost && <button onClick={() => setOpen('game')}>Game</button>}
        {teamGame && !isWatcher && <button onClick={() => setOpen('team')}>Team</button>}
        <button onClick={() => setOpen('me')}>Me</button>
        <button onClick={() => setOpen('scores')}>Scores</button>
      </nav>

      {isHost && open === 'game' && (
        <Sheet title="Game" onClose={close}>
          <p className="muted">Pick a game. Everyone has to ready up again when it changes.</p>
          {/* Every tile is the same size: a 16:10 picture area (empty until a game has a picture) with the name under it. */}
          <div className="game-grid" role="radiogroup" aria-label="Game">
            {/* The Random tile is always the first option. Picking it chooses nothing yet: once everyone is ready and the countdown ends, the server picks a game and everyone watches the roulette. */}
            <button role="radio" aria-checked={room.settings.random} className={room.settings.random ? 'game-tile selected' : 'game-tile'}
              onClick={() => { void run(updateSettings({ gameId: 'random' })); close(); }}>
              <RandomArt />
              <span className="game-name">Random</span>
            </button>
            {GAMES.map((g) => (
              <button key={g.id} role="radio" aria-checked={g.id === room.settings.gameId && !room.settings.random}
                className={g.id === room.settings.gameId && !room.settings.random ? 'game-tile selected' : 'game-tile'}
                onClick={() => { void run(updateSettings({ gameId: g.id })); close(); }}>
                <span className="game-art">{images[g.id] && <img src={images[g.id]} alt="" draggable={false} />}</span>
                <span className="game-name">{g.name}{getGame(g.id)?.teams && <span className="badge team-badge">Teams</span>}</span>
              </button>
            ))}
          </div>
          {game && <p className="muted">{game.description}</p>}
        </Sheet>
      )}

      {open === 'team' && game?.teams && (
        <Sheet title="Teams" onClose={close}>
          <TeamPanel hideTitle room={room} selfId={selfId} isHost={isHost} watchingIds={watchingIds}
            onPick={(team) => run(setTeam(team))} onSwap={(allowed) => run(updateSettings({ teamSwap: allowed }))} onHandicap={(team, value) => run(setHandicap(team, value))} />
        </Sheet>
      )}

      {open === 'me' && (
        <Sheet title="Me" onClose={close}>
          {/* Players pick their own color, from the ones nobody else has (it is their color in every game). Spectators don't need it. */}
          {!isWatcher && <ColorPicker colors={room.colors} selfId={selfId} onPick={(color) => run(setColor(color))} />}
          {/* Play / Watch: switch whenever you like between rounds. Your points stay, and a watcher can still win the session. */}
          {spectatorOnly ? (
            <p className="muted">The room has {MAX_PLAYERS} players already, so you're a spectator. If a player leaves, you can take their seat.</p>
          ) : (
            <div className="mode-toggle" role="radiogroup" aria-label="Play or watch">
              <button role="radio" aria-checked={!isWatcher} className={!isWatcher ? 'on' : ''} onClick={() => isWatcher && run(setWatching(false))}>Play</button>
              <button role="radio" aria-checked={isWatcher} className={isWatcher ? 'on' : ''} onClick={() => !isWatcher && run(setWatching(true))}>Watch</button>
            </div>
          )}
          {isWatcher && <p className="muted">Watching: you keep your points, you can bet on the winner (the bet is on the main screen, above Ready), and you can still win the session.</p>}
        </Sheet>
      )}

      {open === 'scores' && (
        <Sheet title="Scores" onClose={close}>
          <ul className="players">
            {room.players.map((p) => {
              const watching = watchingIds.includes(p.id);
              return (
                <li key={p.id} className={watching ? 'spectator' : ''}>
                  <Avatar url={p.avatarUrl} name={p.name} size={44} />
                  <span className="color-dot" style={{ background: room.colors[p.id] }} title="Their color in every game" />
                  <span className="player-name">{p.name}{p.id === selfId && ' (you)'}</span>
                  {p.id === room.hostId && <span className="badge">Host</span>}
                  {watching && <span className="muted">watching</span>}
                  {room.offlineIds.includes(p.id) && <span className="muted" title="Their connection dropped: their seat is held for a short while">reconnecting…</span>}
                  {(room.scores[p.id] ?? 0) > 0 && <span className="badge wins" title="Rounds won this session"><Icon name="trophy" /> {room.scores[p.id]}</span>}
                  {room.readyIds.includes(p.id) && <span className="ready-mark" title="Ready"><Icon name="check" /></span>}
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}

      {open === 'room' && (
        <Sheet title="Room" onClose={close}>
          <RoomSheet room={room} isHost={isHost} onSettings={(change) => run(updateSettings(change))}
            onEndSession={() => { void run(endSession()); close(); }} onClose={() => { void run(closeRoom()); close(); }} onLeave={onLeave} />
        </Sheet>
      )}
    </main>
  );
}

