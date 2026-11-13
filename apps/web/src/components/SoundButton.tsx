import { audio } from '../audio/spatialAudio';
import { useMuted } from '../audio/soundSettings';

/** Icon-only sound on/off, pinned to the top of every screen. It mutes the music and every effect. */
export function SoundButton() {
  const [muted, setMuted] = useMuted(); // remembered in this browser
  const label = muted ? 'Sound off (tap to turn on)' : 'Sound on (tap to turn off)';
  // Tapping also counts as the touch browsers need before they allow sound.
  return (
    <button className="sound-btn" aria-pressed={muted} aria-label={label} title={label}
      onClick={() => { audio.unlock(); setMuted(!muted); }}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}
