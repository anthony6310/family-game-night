import type { GameAction, GameId, GameView, TeamId } from '@fgn/shared';

/** What a team game's engine is given when the round starts. */
export interface TeamContext {
  teams: Record<string, TeamId>;
}

/**
 * What every game must provide. Engines are PURE: no timers, no sockets, no clock reads
 * (the caller passes `now`). The room manager owns the plumbing; a game only owns its rules.
 * Adding a game = implement this, register it in RoomManager, add an entry to GAMES.
 */
// `any` for the state type: each engine has its own private state shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface GameEngine<S = any> {
  id: GameId;
  /** Fresh state for a round with these players. A TEAM game also gets who is on which team and each team's head start (other games ignore it). */
  init(playerIds: string[], now: number, teams?: TeamContext): S;
  /** Apply one player action and return the NEW state (or the same one if it's not allowed). */
  reduce(state: S, playerId: string, action: GameAction, now: number): S;
  /**
   * Optional. Games with continuous movement (physics) provide this and the room calls it ~40 times a
   * second while the round runs: advance the simulation by `dt` seconds. Turn-based games, like Tap
   * Race, simply leave it out. Still pure: the caller supplies both `dt` and `now`.
   */
  tick?(state: S, dt: number, now: number): S;
  /** True when the round should end (checked after each action; the room also ends it on a timer). */
  isOver(state: S, now: number): boolean;
  /** The winner's player id, or null for a draw. */
  getWinner(state: S): string | null;
  /** Per-player round score, shown on the results screen. */
  scores(state: S): Record<string, number>;
  /** A player left mid-round: drop them from the state. */
  removePlayer(state: S, playerId: string): S;
  /** The slice of state phones are allowed to see. */
  view(state: S): GameView;
}
