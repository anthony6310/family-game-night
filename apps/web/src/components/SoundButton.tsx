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
      {/* A flat speaker icon (inline SVG, so it takes the button's text colour): sound waves when on, a cross when off. */}
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
        <path d="M3 9.5v5h4l5 4.5v-14l-5 4.5H3z" stroke="none" />
        {muted ? (
          <path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" strokeWidth="2" />
        ) : (
          <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" strokeWidth="2" />
        )}
      </svg>
    </button>
  );
}
