// TEMPORARY harness (delete after use): what TEAM SELECTION looks like when a team game is picked directly, and when the roulette lands on one.
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider } from './auth/AuthContext';
import { RoomProvider } from './room/RoomContext';
import { LobbyHub } from './components/lobby/LobbyHub';
void LobbyHub;
import { TeamStep } from './components/lobby/TeamStep';
import './styles.css';

const mk = (id: string, name: string) => ({ id, name, avatarUrl: null, isGuest: true });
const players = [mk('a', 'Anthony'), mk('b', 'Sam'), mk('c', 'Riley'), mk('d', 'Jo'), mk('e', 'Max')];
const base: any = {
  code: 'ABCD', name: 'Family Fun', hasPassword: false, hostId: 'a', players, watchingIds: [], colors: { a: '#e53935', b: '#1e88e5', c: '#43a047', d: '#fb8c00', e: '#00acc1' }, spectatorOnlyIds: [], bets: {}, underdog: null,
  settings: { gameId: 'tug-of-war', random: false, teamSwap: true, handicap: { yellow: 0, purple: 2 } },
  teams: { a: 'yellow', b: 'purple', c: 'yellow', d: 'purple', e: 'yellow' }, readyIds: ['c'], offlineIds: [], phase: 'lobby', scores: { a: 2, b: 1 }, roundsPlayed: 2, countdownEndsAt: null, result: null, game: null, serverTime: Date.now(), roulette: null,
};
const images: any = { 'tap-race': '/games/tap-race.png', snowball: '/games/snowball.png', 'penguin-lasso': '/games/penguin-lasso.png', fishing: '/games/fishing.png', 'santa-sack': '/games/santa-sack.png' };
const noop = async () => {};

/** A phone-sized frame (the transform makes the sheets, which are fixed, stay inside it). */
const Phone = ({ title, children }: { title: string; children: ReactNode }) => (
  <div style={{ margin: 12 }}>
    <div style={{ color: '#fff', fontFamily: 'system-ui', fontWeight: 'bold', marginBottom: 6, maxWidth: 390 }}>{title}</div>
    <div style={{ width: 390, height: 760, overflow: 'hidden', transform: 'translateZ(0)', background: '#1a1a2e', borderRadius: 18, border: '2px solid #444', position: 'relative' }}>{children}</div>
  </div>
);
const _Hub = ({ self, sheet, room = base }: { self: string; sheet?: any; room?: any }) => <LobbyHub room={room} selfId={self} serverNow={() => Date.now()} error={null} images={images} run={noop} onLeave={() => {}} initialSheet={sheet ?? null} />;

const stepRoom = { ...base, phase: 'teams', readyIds: [], watchingIds: ['e'], settings: { ...base.settings, random: true, gameId: 'tug-of-war' } };
const Step = ({ self, counting = false }: { self: string; counting?: boolean }) => <TeamStep room={{ ...stepRoom, teamCountdownEndsAt: counting ? Date.now() + 2500 : null }} selfId={self} serverNow={() => Date.now()} error={null} run={noop} />;
createRoot(document.getElementById('root')!).render(
  <BrowserRouter><AuthProvider><RoomProvider>
    <p style={{ color: '#fff', fontFamily: 'system-ui', margin: '12px', maxWidth: 900 }}>
      <b>The team step</b>: when the Random tile lands on a team game, the round pauses here (no Ready step). The host starts it.
    </p>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <Phone title="The host's view"><Step self="a" /></Phone>
      <Phone title="A player's view"><Step self="b" /></Phone>
      <Phone title="A spectator's view (bets on a team)"><Step self="e" /></Phone>
      <Phone title="After the host pressed Start: the countdown, with Cancel (host)"><Step self="a" counting /></Phone>
    </div>
  </RoomProvider></AuthProvider></BrowserRouter>,
);
