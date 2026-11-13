/**
 * Snow sounds, MADE LIVE by the browser's audio engine (no sound files). Snow crunch is basically very short bursts of
 * filtered noise: a high, squeaky band for the "crunch" and a low band for the body of it. Each function schedules one
 * sound starting at time `t` on `out` and cleans itself up. They only use the generic Web Audio API, so the very same
 * code runs in a real AudioContext (the game) and in an OfflineAudioContext (to measure it in a test).
 *
 * `strength` is 0..1 (how hard / how fast). To use a recorded clip instead one day, replace these functions: the mixer
 * only needs something with this signature.
 */
export type SoundFn = (ctx: BaseAudioContext, out: AudioNode, t: number, strength: number) => void;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise, made once per audio context and shared by every sound. */
function noise(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A tiny burst of noise through one filter (exported: other sound sets, like the typewriter click, are built from the same grains) with a sharp attack and a fast fade: one "crunch" grain. */
export function grain(
  ctx: BaseAudioContext, out: AudioNode, t: number,
  { type, freq, q, gain, duration }: { type: BiquadFilterType; freq: number; q: number; gain: number; duration: number },
) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, t);
  envelope.gain.linearRampToValueAtTime(gain, t + 0.003); // instant attack, like a crack
  envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration); // then it dies away
  source.connect(filter).connect(envelope).connect(out);
  source.start(t, Math.random() * 0.9); // a different slice of noise every time, so no two crunches are identical
  source.stop(t + duration + 0.02);
}

/** A soft crunch for a ball that is rolling: two or three quick grains. Meant to be heard over and over, so it is quiet. */
export const rollCrunch: SoundFn = (ctx, out, t, strength) => {
  const grains = 2 + Math.round(Math.random() * strength * 1.5);
  let at = t;
  for (let i = 0; i < grains; i++) {
    grain(ctx, out, at, { type: 'bandpass', freq: rand(1800, 4200), q: rand(1.2, 2.4), gain: rand(0.5, 0.9), duration: rand(0.03, 0.06) });
    at += rand(0.012, 0.03);
  }
  grain(ctx, out, t, { type: 'lowpass', freq: rand(500, 800), q: 0.7, gain: 0.35, duration: 0.07 }); // the soft body underneath
};

/** A much louder, longer crunch for two balls smashing together: many grains, a wide band, and a low thud. */
export const collisionCrunch: SoundFn = (ctx, out, t, strength) => {
  const grains = 6 + Math.round(strength * 4);
  let at = t;
  for (let i = 0; i < grains; i++) {
    grain(ctx, out, at, { type: 'bandpass', freq: rand(900, 4500), q: rand(0.9, 2), gain: rand(0.7, 1), duration: rand(0.05, 0.11) });
    at += rand(0.008, 0.024);
  }
  grain(ctx, out, t, { type: 'lowpass', freq: 700, q: 0.7, gain: 1, duration: 0.22 }); // a big soft whump of snow

  // The thud: a sine that drops in pitch, like something heavy landing in snow.
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(rand(130, 160), t);
  thud.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, t);
  envelope.gain.linearRampToValueAtTime(0.8, t + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  thud.connect(envelope).connect(out);
  thud.start(t);
  thud.stop(t + 0.25);
};
