import { useEffect, useRef, useState } from 'react';
import { GAME_INTRO_COUNT_SECONDS, GAME_INTRO_HOLD_SECONDS, GAME_INTRO_SECONDS } from '@fgn/shared';
import { audio } from '../audio/spatialAudio';
import { createRoundClock } from '../audio/roundClock';

const GO_SHOWN_MS = 900; // "GO!" stays on screen this long after the moment of GO
const COUNT_FROM = 3; // "3, 2, 1, GO!"
const REDRAW_MAX_MS = 200; // (so a change of GO, or of the clock estimate, is picked up soon)

/**
 * How far the camera should have moved from the overview over the players to the player's own view, 0..1, for a round that starts at `startsAt`
 * (the server clock). It stays STATIC over everyone for GAME_INTRO_HOLD_SECONDS (the players see the game first, no countdown yet), then eases in through the 3, 2, 1, so it is on the player at GO.
 */
export function introProgress(startsAt: number, now: number): number {
  const moveStart = startsAt - GAME_INTRO_COUNT_SECONDS * 1000; // (== the hold's end: GAME_INTRO_SECONDS - HOLD)
  const u = Math.min(1, Math.max(0, (now - moveStart) / (GAME_INTRO_COUNT_SECONDS * 1000)));
  return u * u * (3 - 2 * u);
}

/**
 * THE start countdown for every game (GAME_RULES.md #10): a big "3, 2, 1, GO!" over the scene, timed from the server's clock so every phone hits GO together.
 * `goAt` is the moment the player gets control: the round's `startsAt` for most games, or the end of the opening sequence for a game that has one (Fishing's cast).
 * Each number is bigger than the last, pops in and fades; it ticks like the end-of-round clock (the same sounds, getting louder) and the whistle blows at GO.
 * It shows only while GO is at most 3 seconds away, so a game with a long opening gets it at the end of the opening.
 */
export function StartCountdown({ goAt, serverNow }: { goAt: number; serverNow: () => number }) {
  const [, redraw] = useState(0);
  // Redraw at the moment the number changes (and when GO! has been up long enough), never more than REDRAW_MAX_MS apart. (A fixed 50 ms poll showed each number up to 50 ms late, by a
  // different amount on every phone: measured, two devices' 3, 2, 1 drifted 40-50 ms apart that way alone.)
  useEffect(() => {
    const r = goAt - serverNow();
    const next = r > COUNT_FROM * 1000 ? r - COUNT_FROM * 1000 : r > 0 ? r - (Math.ceil(r / 1000) - 1) * 1000 : r + GO_SHOWN_MS;
    if (next <= 0) return; // (GO! is over: nothing more to draw)
    const id = window.setTimeout(() => redraw((n) => n + 1), Math.min(REDRAW_MAX_MS, next + 1));
    return () => window.clearTimeout(id);
  });
  const clock = useRef(createRoundClock((sound, gain) => audio.playFlat(sound, gain))).current;
  const primed = useRef(false);
  const remaining = goAt - serverNow();
  if (!primed.current && remaining > (COUNT_FROM - 1) * 1000 && remaining <= COUNT_FROM * 1000) { clock.update(COUNT_FROM + 1); primed.current = true; } // (so the "3" ticks too)
  // The round clock ticks for each of its last 5 seconds, but this countdown starts at 3: the still buffer before it is silent (rule 10), so the clock is never told more than that. (It used to
  // tick at 5 and 4 over the still picture, and the "5" fell whenever this phone received the round's final GO, a different moment on every phone.)
  clock.update(Math.min(remaining / 1000, COUNT_FROM + 0.5));
  if (remaining > COUNT_FROM * 1000 || remaining < -GO_SHOWN_MS) return null; // (never above 3: nothing shows until GO is 3 seconds or less away)
  const label = remaining > 0 ? String(Math.min(COUNT_FROM, Math.ceil(remaining / 1000))) : 'GO!';
  const step = remaining > 0 ? COUNT_FROM - Math.ceil(remaining / 1000) : COUNT_FROM; // 0 for the first number ... COUNT_FROM for GO: each one is bigger than the last
  return (
    <div className="start-count" aria-live="assertive">
      <span key={label} className={remaining > 0 ? 'start-count-num' : 'start-count-num go'} style={{ ['--grow' as string]: 0.8 + step * 0.2 }}>{label}</span>
    </div>
  );
}
