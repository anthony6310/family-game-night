import { isMuted } from './soundSettings';

/**
 * Background music: one cheerful four-bar loop, made from oscillators (no audio files), that plays whenever the
 * app is open and loops forever. It follows the shared mute setting and stays quiet under the game sounds.
 *
 * To add more tracks later: make another `Track` below and have `pickTrack` choose between them
 * (for example per game or per screen). Everything else (scheduling, volume, mute) is shared.
 */
interface Track {
  bpm: number;
  /** One chord per bar: the bass note, then the notes of the chord (semitones above C3). */
  bars: { bass: number; chord: number[] }[];
  /** The tune played over the chords: [bar-relative beat, semitone above C3, length in beats]. One list per bar. */
  melody: [number, number, number][][];
}

// "Snowy days": C – Am – F – G, 4 beats a bar, a simple bouncing bass with a tinkly tune on top.
const SNOWY_DAYS: Track = {
  bpm: 150,
  bars: [
    { bass: 0, chord: [12, 16, 19] }, // C
    { bass: -3, chord: [12, 16, 19] }, // Am (bass A, chord notes still close to C: keeps it soft)
    { bass: -7, chord: [12, 17, 21] }, // F
    { bass: -5, chord: [14, 19, 23] }, // G
  ],
  melody: [
    [[0, 24, 1], [1, 28, 0.5], [1.5, 31, 0.5], [2, 28, 1], [3, 26, 1]],
    [[0, 24, 1], [1, 21, 0.5], [1.5, 24, 0.5], [2, 28, 1.5], [3.5, 26, 0.5]],
    [[0, 29, 1], [1, 28, 0.5], [1.5, 26, 0.5], [2, 24, 1], [3, 21, 1]],
    [[0, 26, 1], [1, 28, 0.5], [1.5, 26, 0.5], [2, 23, 1], [3, 26, 1]],
  ],
};

const pickTrack = (): Track => SNOWY_DAYS; // one track for now

const MUSIC_VOLUME = 0.1; // overall loudness: a background bed, well below the effects
const C3 = 130.81; // Hz of the note all semitone offsets count from
const hz = (semitones: number) => C3 * 2 ** (semitones / 12);

/** One soft note: a quick fade in and a longer fade out, so there are no clicks. */
function note(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, freq: number, start: number, length: number, level: number) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(level, start + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** Schedules one bar of the track starting at `t` (seconds on the audio clock). */
function playBar(ctx: BaseAudioContext, out: AudioNode, track: Track, index: number, t: number) {
  const beat = 60 / track.bpm;
  const bar = track.bars[index];
  // Bass: root on beats 1 and 3, the fifth on 2 and 4, for a gentle bounce.
  [0, 1, 2, 3].forEach((b) => note(ctx, out, 'triangle', hz(bar.bass + (b % 2 ? 7 : 0)), t + b * beat, beat * 0.9, 0.5));
  // Chord: a soft pad held across the bar.
  bar.chord.forEach((s) => note(ctx, out, 'sine', hz(s), t, beat * 3.8, 0.12));
  // Tune: bright little square-ish notes (triangle keeps them mellow).
  for (const [at, s, len] of track.melody[index]) note(ctx, out, 'triangle', hz(s), t + at * beat, len * beat * 0.95, 0.28);
}

let started = false;

/** Starts the loop on the given (running) audio context. Safe to call more than once. */
export function startMusic(ctx: AudioContext) {
  if (started) return;
  started = true;
  const track = pickTrack();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const barLength = (60 / track.bpm) * 4;
  let nextBar = 0; // when the next bar starts, on the audio clock
  let index = 0;
  let wasMuted = true;

  // Every 100 ms: follow the mute setting, and queue bars a little ahead of time so playback never gaps.
  setInterval(() => {
    const muted = isMuted() || ctx.state !== 'running';
    master.gain.setTargetAtTime(muted ? 0 : MUSIC_VOLUME, ctx.currentTime, 0.1); // smooth fade, no pop
    if (muted) {
      wasMuted = true;
      return; // nothing is queued while silent
    }
    if (wasMuted) {
      nextBar = ctx.currentTime + 0.1; // resuming: start a fresh bar from the top of the tune
      index = 0;
      wasMuted = false;
    }
    while (nextBar < ctx.currentTime + 0.6) {
      playBar(ctx, master, track, index, nextBar);
      nextBar += barLength;
      index = (index + 1) % track.bars.length;
    }
  }, 100);
}
