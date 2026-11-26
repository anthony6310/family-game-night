import { useEffect, useRef, useState } from 'react';
import { ACTIVE_GAMES, ROULETTE_HOLD_SECONDS, getGame, type GameId } from '@fgn/shared';
import { audio } from '../audio/spatialAudio';
import { typewriterClick } from '../audio/clickSounds';

/** One tile on a carousel: the Random tile (no picture, a question mark) or a game. */
interface Item { key: string; name: string; image?: string; random?: boolean }

const SPACING = 63; // tiles are 60% of the carousel's width, with a 3% gap: one tile along is 63% of its width
const CENTER = 20; // the middle tile's left edge, in % of the width (so it is centered)

const wrapDelta = (d: number, size: number) => { const m = ((d % size) + size) % size; return m > size / 2 ? m - size : m; }; // (the shortest way round a loop: -size/2 .. size/2)

/**
 * A LOOP of tiles: it goes round and round, so going from the last tile to the first is one step forward, not a long rewind. `frame` is asked every animation frame where the loop is (a
 * position along it, in tiles: 2.0 = tile 2 in the middle, 2.5 = halfway to tile 3, and it may grow without end); each tile is placed by how far it is from that position, going the
 * short way round, so a tile that leaves one edge comes back in at the other (out of sight). The tile in the middle is bright and full size, the others dimmer and smaller.
 */
function LoopTrack({ items, frame }: { items: Item[]; frame: (nowMs: number) => number }) {
  const box = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  useEffect(() => {
    let raf = 0;
    const place = (now: number) => {
      raf = requestAnimationFrame(place);
      const width = box.current?.clientWidth ?? 0;
      const pos = frameRef.current(now);
      items.forEach((_, i) => {
        const el = tiles.current[i];
        if (!el) return;
        const d = wrapDelta(i - pos, items.length), a = Math.min(1, Math.abs(d));
        el.style.transform = `translateX(${((CENTER + d * SPACING) / 100) * width}px) scale(${1 - 0.12 * a})`;
        el.style.opacity = String(Math.abs(d) > 1.7 ? 0 : 1 - 0.6 * a);
        el.classList.toggle('selected', Math.abs(d) < 0.5);
      });
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [items]);
  return (
    <div className="game-carousel" ref={box}>
      {/* A hidden tile gives the carousel its height; the real tiles are laid over it. */}
      <div className="game-tile game-carousel-tile game-carousel-sizer" aria-hidden="true"><span className="game-art" /><span className="game-name">&nbsp;</span></div>
      {items.map((item, i) => (
        <div key={item.key} ref={(el) => { tiles.current[i] = el; }} className="game-tile game-carousel-tile game-carousel-abs" aria-label={item.name}>
          {item.random ? <RandomArt /> : <span className="game-art">{item.image && <img src={item.image} alt="" draggable={false} />}</span>}
          <span className="game-name">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

const gameItem = (g: { id: string; name: string }, images: Partial<Record<GameId, string>>): Item => ({ key: g.id, name: g.name, image: images[g.id as GameId] });

/**
 * The game picker for everyone who is not the host: a loop of the same tiles the host picks from, with the Random tile first. It rests on Random until the host picks something, and when the
 * host picks, the loop slides, quickly and with a snap (a little overshoot), the short way round to that game's tile. It is only a display: the host decides.
 */
export function GameCarousel({ selectedId, random, images }: { selectedId: GameId | null; random: boolean; images: Partial<Record<GameId, string>> }) {
  const items: Item[] = useRef([{ key: 'random', name: 'Random', random: true } as Item, ...ACTIVE_GAMES.map((g) => gameItem(g, images))]).current;
  const target = selectedId && !random ? 1 + ACTIVE_GAMES.findIndex((g) => g.id === selectedId) : 0; // (0 is the Random tile)
  const anim = useRef({ pos: target, from: target, to: target, t0: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;
  const frame = (now: number) => {
    const a = anim.current;
    if (a.to % items.length !== targetRef.current) { // the host picked something else: slide the short way round (the position keeps growing; it only matters modulo the loop)
      a.from = a.pos;
      a.to = a.pos + wrapDelta(targetRef.current - a.pos, items.length);
      a.t0 = now;
    }
    const u = Math.min(1, (now - a.t0) / 480);
    const c1 = 1.1, c3 = c1 + 1, e = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); // (ease out with a little overshoot: snappy)
    a.pos = u >= 1 ? a.to : a.from + (a.to - a.from) * e;
    return a.pos;
  };
  return <LoopTrack items={items} frame={frame} />;
}

/**
 * The ROULETTE (GAME_RULES.md #13), shown to everyone when the host chose Random: the loop of games spins fast and eases out, getting slower and slower, until it comes to rest on the game
 * the server chose. Where it is at any moment comes from the server's clock (`startsAt` .. `endsAt` minus the hold at the end), so every phone shows the same thing and a late arrival joins in the middle of it.
 * It ticks each time a tile goes by.
 */
export function RouletteWheel({ gameId, startsAt, endsAt, serverNow, images }: { gameId: GameId; startsAt: number; endsAt: number; serverNow: () => number; images: Partial<Record<GameId, string>> }) {
  const items = useRef(ACTIVE_GAMES.map((g) => gameItem(g, images))).current;
  const target = Math.max(0, ACTIVE_GAMES.findIndex((g) => g.id === gameId));
  const LAPS = 4; // whole laps before it settles
  const total = LAPS * items.length + target;
  const lastTick = useRef(-1);
  const frame = () => {
    const spinMs = Math.max(1, endsAt - startsAt - ROULETTE_HOLD_SECONDS * 1000); // (the last ROULETTE_HOLD_SECONDS of the step the wheel has stopped: the pick stays in view)
    const u = Math.min(1, Math.max(0, (serverNow() - startsAt) / spinMs));
    const pos = total * (1 - Math.pow(1 - u, 4)); // fast at first, then slower and slower: the last tile creeps into place
    const whole = Math.floor(pos + 0.5); // (a tile is in the middle when pos is a whole number)
    if (whole !== lastTick.current) { if (lastTick.current >= 0 && u < 1) audio.playFlat(typewriterClick, 0.22, 0.6 + 0.4 * (1 - u)); lastTick.current = whole; }
    return pos;
  };
  return <LoopTrack items={items} frame={frame} />;
}

/** The full-screen roulette step, for everyone (the host too): the options are gone, just the wheel, then the name of the game it landed on. */
export function RouletteScreen({ gameId, startsAt, endsAt, serverNow, images }: { gameId: GameId; startsAt: number; endsAt: number; serverNow: () => number; images: Partial<Record<GameId, string>> }) {
  const game = getGame(gameId);
  const done = useDone(endsAt - ROULETTE_HOLD_SECONDS * 1000, serverNow); // (it has landed when the spin is over; then the pick is held for ROULETTE_HOLD_SECONDS more)
  return (
    <main className="roulette-screen">
      <p className="roulette-kicker">{done ? 'Your game is…' : 'Picking a game…'}</p>
      <div className="roulette-wheel">
        <RouletteWheel gameId={gameId} startsAt={startsAt} endsAt={endsAt} serverNow={serverNow} images={images} />
        <div className="roulette-pointer" aria-hidden="true" />
      </div>
      <h1 className={done ? 'roulette-name landed' : 'roulette-name'}>{done ? game?.name : ' '}</h1>
      {done && game && <p className="muted roulette-desc">{game.description}</p>}
    </main>
  );
}

/** True once the server's clock has passed `endsAt` (re-checked ten times a second while it is not). */
function useDone(endsAt: number, serverNow: () => number): boolean {
  const [done, setDone] = useState(serverNow() >= endsAt);
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => { if (serverNow() >= endsAt) setDone(true); }, 100);
    return () => clearInterval(id);
  }, [done, endsAt, serverNow]);
  return done;
}

/** The picture area of the Random tile: a question mark in the start countdown's look (it has no screenshot, it is not a game). */
export function RandomArt() {
  return <span className="game-art random-art" aria-hidden="true"><span className="random-q">?</span></span>;
}
