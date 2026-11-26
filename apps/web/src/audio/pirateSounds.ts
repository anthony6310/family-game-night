import type { SoundFn } from './snowSounds';
import type { BedFn } from './spatialAudio';
import { R, bass, brass, noise, noiseBuffer, scaled, strings, timpani, tone } from './synth';

/**
 * Broadside Battle's sounds, made live by the browser's audio engine (no files). Every one was picked by ear from the
 * sound picker (three variations of each); the pick's name is in each comment. `strength` is 0..1 (how near / how big).
 * The sea ambience and the battle theme are "beds" (they loop until stopped): see `audio.startBed`.
 */

/** Little dry crackles, like a burning fuse. */
function crackles(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, f = 3000, g = 0.18) {
  for (let i = 0; i < n; i++) noise(ctx, out, t + R(0, dur), { type: 'highpass', f: f * R(0.8, 1.6), q: 0.8, g: g * R(0.3, 1), dur: R(0.012, 0.03), att: 0.001 });
}
/** Wood and rubble falling: low-mid knocks. */
function debris(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, g = 0.25) {
  for (let i = 0; i < n; i++) {
    const at = t + R(0, dur);
    noise(ctx, out, at, { type: 'bandpass', f: R(300, 1400), q: 2, g: g * R(0.3, 1), dur: R(0.03, 0.09), att: 0.001 });
    if (Math.random() < 0.4) tone(ctx, out, at, { type: 'triangle', f: R(180, 420), f2: R(90, 160), dur: 0.07, g: 0.12, att: 0.001 });
  }
}
/** A metal clank: ringing resonances of noise plus harsh square tones (pure sine bells sound like glass, not metal). */
function clank(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, g = 1, dur = 0.2) {
  [1, 1.58, 2.31, 3.07].forEach((m, i) => noise(ctx, out, t, { type: 'bandpass', f: f * m, q: 25, g: (0.9 * g) / (1 + i * 0.4), dur: dur * (1 - i * 0.15), att: 0.0008 }));
  noise(ctx, out, t, { type: 'highpass', f: 4000, q: 0.7, g: 0.35 * g, dur: 0.03, att: 0.0005 });
  [1, 1.41, 2.24].forEach((m) => tone(ctx, out, t, { type: 'square', f: f * m * 0.5, dur: dur * 0.5, g: 0.035 * g, att: 0.0008 }));
}

// ---------- the effects ----------

/** WICK LIGHTS: "Match strike": a quick hiss and a sizzle of crackles. */
export const wickLight: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'highpass', f: 4200, q: 0.9, g: 0.22, dur: 0.18 });
  noise(ctx, out, t + 0.06, { type: 'bandpass', f: 5200, q: 0.7, g: 0.12, dur: 0.7 });
  crackles(ctx, out, t + 0.05, 0.5, 8);
};

/** WICK BURNING: "Rising fizz": the one second of tension before the boom (the same length as the wick). */
export const wickBurn: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'bandpass', f: 2500, f2: 7500, q: 0.9, g: 0.2, dur: 1.0, att: 0.4 });
  crackles(ctx, out, t + 0.3, 0.7, 16, 4000);
};

/** CANNON FIRES: "Deep and echoing": a low thump that drops away, a rumble, a crack and three fading echoes. */
export const cannonBoom: SoundFn = (ctx, out, t, strength) => {
  const k = 0.35 + 0.65 * strength;
  const mix = scaled(ctx, out, 1);
  tone(ctx, mix, t, { f: 95, f2: 26, dur: 0.95, g: 0.7 * k, att: 0.012 });
  noise(ctx, mix, t, { type: 'lowpass', f: 320, g: 0.8 * k, dur: 0.9, att: 0.004 });
  noise(ctx, mix, t, { type: 'bandpass', f: 1800, q: 0.8, g: 0.5 * k, dur: 0.09, att: 0.001 });
  [0.2, 0.42, 0.7].forEach((d, i) => noise(ctx, mix, t + d, { type: 'lowpass', f: 260, g: (0.28 * k) / (i + 1), dur: 0.5, att: 0.03 }));
};

/** RELOADING: "Chain winch + chain rattle": a ratchet that speeds up, then a rattle of links and a last iron clank (about 1.4 s). */
export const reloadChain: SoundFn = (ctx, out, t) => {
  for (let i = 0; i < 12; i++) {
    const at = t + i * (0.075 - i * 0.003);
    noise(ctx, out, at, { type: 'bandpass', f: 2600, q: 4, g: 0.25, dur: 0.03, att: 0.001 });
    tone(ctx, out, at, { type: 'square', f: 700, dur: 0.02, g: 0.06, att: 0.001 });
  }
  noise(ctx, out, t, { type: 'highpass', f: 5000, g: 0.07, dur: 0.8, att: 0.1 });
  for (let i = 0; i < 7; i++) clank(ctx, out, t + 0.8 + i * 0.045, R(1800, 3200), 0.35, 0.08);
  clank(ctx, out, t + 1.15, 1500, 0.9, 0.2);
};

/** READY TO FIRE: "Double clang": two shrill metal strikes. */
export const readyClang: SoundFn = (ctx, out, t) => {
  clank(ctx, out, t, 2900, 1.0, 0.14);
  clank(ctx, out, t + 0.08, 4300, 1.0, 0.18);
};

/** YOUR BALL HITS THE ENEMY SHIP: "Explosive impact": a big crash with wood and rubble raining down. */
export const shipHit: SoundFn = (ctx, out, t, strength) => {
  const mix = scaled(ctx, out, 0.5 + 0.5 * strength);
  tone(ctx, mix, t, { f: 110, f2: 32, dur: 0.9, g: 0.9, att: 0.005 });
  noise(ctx, mix, t, { type: 'lowpass', f: 900, g: 1.0, dur: 0.9, att: 0.002 });
  noise(ctx, mix, t, { type: 'bandpass', f: 1800, q: 0.7, g: 0.7, dur: 0.3, att: 0.001 });
  debris(ctx, mix, t + 0.08, 1.0, 20, 0.3);
  noise(ctx, mix, t + 0.15, { type: 'lowpass', f: 250, g: 0.35, dur: 1.2, att: 0.1 });
};

/** YOUR SHIP GETS HIT: "Shockwave + long rumble": a deep blast, a wooden crunch, a long rumble and falling debris. */
export const hitReceived: SoundFn = (ctx, out, t, strength) => {
  const mix = scaled(ctx, out, 0.5 + 0.5 * strength);
  tone(ctx, mix, t, { f: 60, f2: 28, dur: 0.8, g: 0.99, att: 0.01 });
  noise(ctx, mix, t, { type: 'lowpass', f: 400, g: 0.88, dur: 0.6 });
  noise(ctx, mix, t, { type: 'highpass', f: 2200, g: 0.44, dur: 0.1, att: 0.001 });
  noise(ctx, mix, t, { type: 'bandpass', f: 500, q: 0.8, g: 0.7, dur: 0.5, att: 0.003 });
  noise(ctx, mix, t + 0.2, { type: 'lowpass', f: 200, g: 0.5, dur: 1.5, att: 0.1 });
  debris(ctx, mix, t + 0.15, 1.0, 14);
};

/** CANNONBALL MISSES: "Deep plunge": a low gloop and a wash of water. */
export const seaSplash: SoundFn = (ctx, out, t, strength) => {
  const mix = scaled(ctx, out, 0.4 + 0.6 * strength);
  tone(ctx, mix, t, { f: 95, f2: 42, dur: 0.4, g: 0.55, att: 0.006 });
  noise(ctx, mix, t, { type: 'bandpass', f: 2200, f2: 450, q: 0.7, g: 0.55, dur: 0.9 });
  noise(ctx, mix, t, { type: 'lowpass', f: 350, g: 0.5, dur: 0.6 });
};

/** BALL HITS THE LEAPING WHALE: "Heavy smack". */
export const whaleBlocked: SoundFn = (ctx, out, t, strength) => {
  const mix = scaled(ctx, out, 0.4 + 0.6 * strength);
  noise(ctx, mix, t, { type: 'bandpass', f: 800, q: 0.9, g: 0.9, dur: 0.18, att: 0.002 });
  tone(ctx, mix, t, { f: 110, f2: 45, dur: 0.4, g: 0.7, att: 0.004 });
  noise(ctx, mix, t + 0.04, { type: 'lowpass', f: 300, g: 0.5, dur: 0.4 });
};

/** WHALE RUMBLE (before the big breach): "Deep rumble": 2.2 s of low noise swelling in, with a wobbling sub tone. */
export const whaleRumble: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'lowpass', f: 150, q: 1, g: 0.9, dur: 2.2, att: 1.4 });
  tone(ctx, out, t, { f: 38, f2: 30, dur: 2.2, g: 0.5, att: 1.4, vib: [7, 3] });
};

/** WHALE BLOW-HOLE SPOUT: "Airy gust". */
export const whaleSpout: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'highpass', f: 1800, q: 0.5, g: 0.35, dur: 1.3, att: 0.4 });
  noise(ctx, out, t, { type: 'lowpass', f: 300, g: 0.3, dur: 1.0, att: 0.2 });
};

/** WHALE BIG SPLASH: "Wave wash": a huge sweep of water with a deep boom under it. */
export const whaleSplash: SoundFn = (ctx, out, t) => {
  noise(ctx, out, t, { type: 'bandpass', f: 3000, f2: 300, q: 0.7, g: 0.8, dur: 1.9, att: 0.04 });
  tone(ctx, out, t, { f: 60, f2: 30, dur: 1.2, g: 0.7, att: 0.01 });
};

// ---------- the beds (they loop until stopped) ----------

/** SEA AMBIENCE: "Gentle waves": low noise that swells and ebbs slowly, with a second slower swell so it never repeats exactly. */
export const seaAmbience: BedFn = (ctx, out) => {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  filter.Q.value = 0.5;
  const level = ctx.createGain();
  level.gain.value = 0.2;
  const lfos = [[0.22, 0.12], [0.13, 0.05]].map(([rate, depth]) => {
    const lfo = ctx.createOscillator();
    const amount = ctx.createGain();
    lfo.frequency.value = rate;
    amount.gain.value = depth;
    lfo.connect(amount).connect(level.gain);
    lfo.start();
    return lfo;
  });
  source.connect(filter).connect(level).connect(out);
  source.start();
  return () => {
    const end = ctx.currentTime + 1.5; // (the bed's own fade-out has finished by then)
    try { source.stop(end); lfos.forEach((l) => l.stop(end)); } catch { /* already stopped */ }
  };
};

// "Storm at sea": A minor, driving, 168 bpm. Eight bars (about 11.4 s) that loop: racing strings, war drums and a heroic brass tune.
const STORM_BEAT = 60 / 168;
const STORM_BARS: [number, boolean][] = [[45, true], [45, true], [53, false], [43, false], [45, true], [53, false], [43, false], [40, false]]; // [root note, minor?] for each bar
/** The tune: [beat from the start of the 8 bars, note, length in beats]. */
const STORM_TUNE: [number, number, number][] = [[0, 69, 2], [2, 72, 1], [3, 76, 1], [4, 81, 2], [6, 79, 1], [7, 76, 1], [8, 77, 2], [10, 81, 1], [11, 77, 1], [12, 79, 2], [14, 83, 1], [15, 79, 1], [16, 81, 2], [18, 84, 1], [19, 81, 1], [20, 84, 2], [22, 81, 1], [23, 77, 1], [24, 83, 2], [26, 79, 1], [27, 74, 1], [28, 80, 4]];

/** Schedules one bar of the theme (at `s`, in audio-clock seconds). Each bar is only about 60 notes, so a phone never builds the whole loop at once. */
function stormBar(ctx: BaseAudioContext, out: AudioNode, bar: number, s: number, loopedBack: boolean) {
  const B = STORM_BEAT;
  const [root, minor] = STORM_BARS[bar];
  for (let k = 0; k < 16; k++) strings(ctx, out, s + (k * B) / 4, root + 12 + (k % 4 === 2 ? 7 : 0), 0.08, 0.035);
  [root + 12, root + 12 + (minor ? 3 : 4), root + 19].forEach((n) => brass(ctx, out, s, n, 2 * B, 0.03));
  bass(ctx, out, s, root - 12, 4 * B * 0.95, 0.12);
  for (let k = 0; k < 4; k++) timpani(ctx, out, s + k * B, k === 0 ? 1.1 : 0.7, 1.1);
  timpani(ctx, out, s + 1.5 * B, 0.45, 1.3);
  for (const [beat, note, len] of STORM_TUNE) {
    if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
    brass(ctx, out, s + (beat - bar * 4) * B, note, len * B * 0.95, 0.075);
    brass(ctx, out, s + (beat - bar * 4) * B, note - 12, len * B * 0.95, 0.04);
  }
  const swell = (dur: number, g: number) => noise(ctx, out, s, { type: 'highpass', f: 5000, q: 0.5, g, dur: dur + 1.2, att: dur }); // (a cymbal swell rising into the next section)
  if (bar === 3) swell(3, 0.1);
  if (bar === 6) swell(2, 0.22);
  if (bar === 7) for (let i = 0; i < 20; i++) timpani(ctx, out, s + (i * B) / 5, 0.2 + (0.8 * i) / 20, 1.1); // the closing drum roll
  if (bar === 0 && loopedBack) timpani(ctx, out, s, 1.3, 0.8); // the big hit that lands the loop
}

/** BATTLE THEME: "Storm at sea", looping bar by bar a little ahead of the audio clock (the same way the app's background music does). */
export const stormTheme: BedFn = (ctx, out) => {
  const barLength = STORM_BEAT * 4;
  let next = ctx.currentTime + 0.15;
  let n = 0;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 1.2) { // (a long look-ahead, so a throttled timer in a background tab never leaves a gap)
      stormBar(ctx, out, n % STORM_BARS.length, next, n >= STORM_BARS.length);
      next += barLength;
      n++;
    }
  }, 100);
  return () => clearInterval(timer);
};
