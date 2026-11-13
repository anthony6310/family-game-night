import { isMuted } from './soundSettings';
import type { SoundFn } from './snowSounds';
import { startMusic } from './music';

/**
 * "Spatial" sound: every sound has a place in the world, and you hear it as if you stood at the listener's place.
 * Close sounds are loud, far ones fade out (linearly, to silence at maxDistance), and a sound to your left or right
 * comes out of the matching ear. World units match the game's (x = east, z = south; the camera looks north, so east
 * is on the right of the screen). Distance and pan are worked out here, rather than with the browser's 3D PannerNode,
 * because that one throws anything a couple of units to the side entirely into one ear.
 */
export const HEARING = {
  refDistance: 4, // closer than this: full volume
  maxDistance: 40, // farther than this: silent (and not even created)
};

export interface Mixer {
  /** Where the listener is standing (the ball you follow, or the free camera's centre). */
  setListener(x: number, z: number): void;
  /** Play `sound` at a world position. `gain` is its overall loudness (1 = full). Silently skipped when out of earshot. */
  play(sound: SoundFn, x: number, z: number, gain: number, strength?: number, at?: number): void;
}

/** Builds a mixer on any audio context (a real one in the game, an offline one in tests). */
export function createMixer(ctx: BaseAudioContext): Mixer {
  // A compressor on the way out stops a pile-up of loud collisions from distorting.
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor).connect(ctx.destination);

  const listener = { x: 0, z: 0 };

  return {
    setListener(x, z) {
      listener.x = x;
      listener.z = z;
    },

    play(sound, x, z, gain, strength = 1, at = ctx.currentTime) {
      const dx = x - listener.x;
      const distance = Math.hypot(dx, z - listener.z);
      if (distance >= HEARING.maxDistance) return; // out of earshot: don't even build it
      // Loudness: full up close, fading in a straight line to silence at maxDistance.
      const near = Math.min(1, Math.max(0, 1 - (distance - HEARING.refDistance) / (HEARING.maxDistance - HEARING.refDistance)));
      // Left/right: east of the listener = right ear. Gentle on purpose (never fully one-sided) so close balls don't sound lopsided.
      const pan = Math.max(-0.8, Math.min(0.8, dx / 20));
      const level = ctx.createGain();
      level.gain.value = gain * near;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      level.connect(panner).connect(master);
      sound(ctx, level, at, strength);
    },
  };
}

// ---------- the real thing, shared by the whole app ----------

let ctx: AudioContext | null = null;
let mixer: Mixer | null = null;

/**
 * Browsers keep audio silent until the person has touched the page. We create and "resume" the audio context on
 * the first tap/click/key, which is long before a round starts (they tap Ready), so sound just works.
 */
function unlock() {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      mixer = createMixer(ctx);
      startMusic(ctx); // background music loops from the first tap on
    }
    if (ctx.state !== 'running') void ctx.resume();
  } catch {
    /* no audio available: the game just stays silent */
  }
}
if (typeof window !== 'undefined') {
  for (const event of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(event, unlock, { passive: true });
}

/** The game's sound output. Every call is a safe no-op while muted, before the first tap, or if audio isn't supported. */
export const audio = {
  unlock,
  setListener(x: number, z: number) {
    mixer?.setListener(x, z);
  },
  play(sound: SoundFn, x: number, z: number, gain: number, strength = 1) {
    if (!mixer || !ctx || ctx.state !== 'running' || isMuted()) return;
    mixer.play(sound, x, z, gain, strength);
  },
};
