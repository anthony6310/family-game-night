/**
 * The small synthesizer every game's sounds are built from (no audio files): filtered noise, glided tones, and the sustained
 * instruments the themes use (brass, strings, bass, timpani). Everything takes any audio context (the real one, or an offline
 * one in a test) and an output node, and schedules itself at time `t`.
 */
// ---------- tiny synth toolkit ----------
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Three seconds of white noise, made once per audio context (long enough to loop as a bed without an audible seam). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}
export const R = (a: number, b: number) => a + Math.random() * (b - a);

export interface NoiseOpts { type?: BiquadFilterType; f: number; f2?: number; q?: number; g: number; dur: number; att?: number }
/** A burst of filtered noise: it swells in over `att`, fades over `dur`, and its filter can sweep from `f` to `f2`. */
export function noise(ctx: BaseAudioContext, out: AudioNode, t: number, o: NoiseOpts) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'lowpass';
  filter.frequency.setValueAtTime(o.f, t);
  if (o.f2) filter.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
  filter.Q.value = o.q ?? 0.7;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.g, t + (o.att ?? 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  source.connect(filter).connect(env).connect(out);
  source.start(t, R(0, 1.5)); // a different slice every time
  source.stop(t + o.dur + 0.05);
}

export interface ToneOpts { type?: OscillatorType; f: number; f2?: number; dur: number; g: number; att?: number; vib?: [number, number] }
/** One oscillator note that glides from `f` to `f2`, with an optional vibrato [rate Hz, depth Hz]. */
export function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts) {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.g, t + (o.att ?? 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  if (o.vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = o.vib[0];
    depth.gain.value = o.vib[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.05);
  }
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.05);
}

/** Everything a sound plays goes through this, so `strength` scales the whole sound. */
export function scaled(ctx: BaseAudioContext, out: AudioNode, k: number): GainNode {
  const mix = ctx.createGain();
  mix.gain.value = k;
  mix.connect(out);
  return mix;
}

/** One sustained note: two detuned oscillators through a low-pass that opens as the note starts (brass, strings and bass differ only in these numbers). */
export function voice(ctx: BaseAudioContext, out: AudioNode, t: number, o: { f: number; dur: number; g: number; type?: OscillatorType; det: number; lp0: number; lp1: number; att: number; rel: number }) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.5;
  filter.frequency.setValueAtTime(o.lp0, t);
  filter.frequency.linearRampToValueAtTime(o.lp1, t + o.att + 0.05);
  const env = ctx.createGain();
  const hold = Math.max(o.att, o.dur - o.rel);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(o.g, t + o.att);
  env.gain.setValueAtTime(o.g, t + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  for (const cents of [-o.det, o.det]) {
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sawtooth';
    osc.frequency.value = o.f;
    osc.detune.value = cents;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }
  filter.connect(env).connect(out);
}
export const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);
export const brass = (ctx: BaseAudioContext, out: AudioNode, t: number, n: number, dur: number, g = 0.07) => voice(ctx, out, t, { f: midiHz(n), dur, g, det: 7, lp0: 500, lp1: 2600, att: 0.07, rel: Math.min(0.12, dur * 0.5) });
export const strings = (ctx: BaseAudioContext, out: AudioNode, t: number, n: number, dur: number, g = 0.04) => voice(ctx, out, t, { f: midiHz(n), dur, g, det: 11, lp0: 900, lp1: 2000, att: Math.min(0.35, dur * 0.4), rel: Math.min(0.3, dur * 0.5) });
export const bass = (ctx: BaseAudioContext, out: AudioNode, t: number, n: number, dur: number, g = 0.12) => voice(ctx, out, t, { f: midiHz(n), dur, g, det: 4, lp0: 250, lp1: 600, att: 0.02, rel: Math.min(0.1, dur * 0.5) });
export function timpani(ctx: BaseAudioContext, out: AudioNode, t: number, k = 1, deep = 1) {
  tone(ctx, out, t, { f: 120 * deep, f2: 58 * deep, dur: 0.7, g: 0.75 * k, att: 0.004 });
  noise(ctx, out, t, { type: 'lowpass', f: 220, g: 0.5 * k, dur: 0.25, att: 0.002 });
  noise(ctx, out, t, { type: 'bandpass', f: 1200, q: 0.8, g: 0.12 * k, dur: 0.05, att: 0.001 });
}


// ---------- shared little building blocks ----------

/** A clean bell-like ping: the note and a quiet octave above it, fading. */
export function ping(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, g = 0.15, dur = 0.35) {
  tone(ctx, out, t, { f, dur, g, att: 0.002 });
  tone(ctx, out, t, { f: f * 2, dur: dur * 0.5, g: g * 0.25, att: 0.002 });
}
/** A bell strike: the note plus two inharmonic overtones that die faster. */
export function bell(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, g = 0.2, dur = 0.9) {
  [1, 2, 2.76].forEach((m, i) => tone(ctx, out, t, { f: f * m, dur: dur / (i + 1), g: g / (i + 1), att: 0.002 }));
}
/** Twinkling high notes scattered over `dur` seconds. */
export function sparkle(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, g = 0.07) {
  for (let i = 0; i < n; i++) tone(ctx, out, t + R(0, dur), { f: R(1500, 3600), dur: R(0.08, 0.2), g: g * R(0.4, 1), att: 0.002 });
}
/** A tiny animal squeak: a quick rising triangle note. */
export function squeak(ctx: BaseAudioContext, out: AudioNode, t: number, f = 900, g = 0.12) {
  tone(ctx, out, t, { type: 'triangle', f, f2: f * 1.7, dur: 0.1, g, att: 0.004 });
}
/** A short bird chirp: two quick glides. */
export function chirp(ctx: BaseAudioContext, out: AudioNode, t: number, f = 3000, g = 0.06) {
  tone(ctx, out, t, { f, f2: f * R(1.2, 1.5), dur: R(0.05, 0.09), g, att: 0.004 });
  tone(ctx, out, t + 0.09, { f: f * 1.3, f2: f * 0.9, dur: 0.06, g: g * 0.8, att: 0.004 });
}
/** A dull thump on earth or snow. */
export function thud(ctx: BaseAudioContext, out: AudioNode, t: number, k = 1) {
  tone(ctx, out, t, { f: 95, f2: 45, dur: 0.22, g: 0.6 * k, att: 0.004 });
  noise(ctx, out, t, { type: 'lowpass', f: 300, g: 0.5 * k, dur: 0.18, att: 0.002 });
}
/** Little stones (or ice chips) skittering. */
export function pebbles(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, g = 0.2) {
  for (let i = 0; i < n; i++) noise(ctx, out, t + R(0, dur), { type: 'bandpass', f: R(1500, 4500), q: 2, g: g * R(0.3, 1), dur: R(0.015, 0.04), att: 0.001 });
}
/** Little dry crackles, like a burning fuse or crisp snow. */
export function crackles(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, n: number, f = 3000, g = 0.18) {
  for (let i = 0; i < n; i++) noise(ctx, out, t + R(0, dur), { type: 'highpass', f: f * R(0.8, 1.6), q: 0.8, g: g * R(0.3, 1), dur: R(0.012, 0.03), att: 0.001 });
}
/** A metal clank: ringing resonances of noise plus harsh square tones (pure sine bells sound like glass, not metal). */
export function clank(ctx: BaseAudioContext, out: AudioNode, t: number, f: number, g = 1, dur = 0.2) {
  [1, 1.58, 2.31, 3.07].forEach((m, i) => noise(ctx, out, t, { type: 'bandpass', f: f * m, q: 25, g: (0.9 * g) / (1 + i * 0.4), dur: dur * (1 - i * 0.15), att: 0.0008 }));
  noise(ctx, out, t, { type: 'highpass', f: 4000, q: 0.7, g: 0.35 * g, dur: 0.03, att: 0.0005 });
  [1, 1.41, 2.24].forEach((m) => tone(ctx, out, t, { type: 'square', f: f * m * 0.5, dur: dur * 0.5, g: 0.035 * g, att: 0.0008 }));
}
/** A sweep of band-passed noise (a whoosh, a gust, a wave wash). */
export function whoosh(ctx: BaseAudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, g = 0.25, att = dur * 0.3, q = 0.8) {
  noise(ctx, out, t, { type: 'bandpass', f: f0, f2: f1, q, g, dur, att });
}
/** A bed of wind or sea for `dur` seconds: band-passed noise with slow swells (and an optional drifting pitch). Loops are made by scheduling more. */
export function windBed(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, o: { f: number; q: number; g: number; rate: number; depth: number; drift?: number; type?: BiquadFilterType }) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.frequency.value = o.f;
  filter.Q.value = o.q;
  const level = ctx.createGain();
  level.gain.value = o.g;
  const swell = ctx.createOscillator();
  const swellAmount = ctx.createGain();
  swell.frequency.value = o.rate;
  swellAmount.gain.value = o.depth;
  swell.connect(swellAmount).connect(level.gain);
  if (o.drift) {
    const drift = ctx.createOscillator();
    const driftAmount = ctx.createGain();
    drift.frequency.value = o.rate * 0.7;
    driftAmount.gain.value = o.drift;
    drift.connect(driftAmount).connect(filter.frequency);
    drift.start(t); drift.stop(t + dur + 0.05);
  }
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0.0001, t);
  fade.gain.linearRampToValueAtTime(1, t + 0.5);
  fade.gain.setValueAtTime(1, t + dur - 0.7);
  fade.gain.linearRampToValueAtTime(0.0001, t + dur);
  source.connect(filter).connect(level).connect(fade).connect(out);
  source.start(t, R(0, 1.5)); source.stop(t + dur + 0.05);
  swell.start(t); swell.stop(t + dur + 0.05);
}

/** A looping bed of wind or hum that runs until the returned function stops it: band-passed noise with slow swells and an optional drifting pitch (the same sound as `windBed`, endless). */
export function windLoop(ctx: BaseAudioContext, out: AudioNode, o: { f: number; q: number; g: number; rate: number; depth: number; drift?: number; type?: BiquadFilterType; tones?: { f: number; g: number; type?: OscillatorType }[] }): () => void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.frequency.value = o.f;
  filter.Q.value = o.q;
  const level = ctx.createGain();
  level.gain.value = o.g;
  const swell = ctx.createOscillator();
  const swellAmount = ctx.createGain();
  swell.frequency.value = o.rate;
  swellAmount.gain.value = o.depth;
  swell.connect(swellAmount).connect(level.gain);
  const stoppable: { stop(when?: number): void }[] = [source, swell];
  if (o.drift) {
    const drift = ctx.createOscillator();
    const driftAmount = ctx.createGain();
    drift.frequency.value = o.rate * 0.7;
    driftAmount.gain.value = o.drift;
    drift.connect(driftAmount).connect(filter.frequency);
    drift.start();
    stoppable.push(drift);
  }
  for (const tn of o.tones ?? []) { // steady tones under the noise (a mains hum, a buzz)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tn.type ?? 'sawtooth';
    osc.frequency.value = tn.f;
    gain.gain.value = tn.g;
    osc.connect(gain).connect(out);
    osc.start();
    stoppable.push(osc);
  }
  source.connect(filter).connect(level).connect(out);
  source.start();
  swell.start();
  return () => {
    const end = ctx.currentTime + 1.5; // (the bed's own fade-out has finished by then)
    for (const s of stoppable) { try { s.stop(end); } catch { /* already stopped */ } }
  };
}
