import { useState } from 'react';
import { PLAYER_COLORS } from '@fgn/shared';

interface Props {
  /** Everyone's color in the room, by player id. */
  colors: Record<string, string>;
  /** Who I am: my own color is the swatch shown, and every other color that someone else has is left out of the options. */
  selfId: string | null;
  /** Pick a color. */
  onPick: (color: string) => void;
}

/**
 * "Your color": by default just ONE swatch, in the color you have now. Tap it to open up the other colors you can pick (up to 16,
 * leaving out the ones other people already have), and tap one to switch to it. The color you pick is the color you have in every
 * game (your ball, your button, your skater, your name tag), so everyone is easy to tell apart.
 */
export function ColorPicker({ colors, selfId, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const mine = selfId ? colors[selfId] : undefined;
  const takenByOthers = new Set(Object.entries(colors).filter(([id]) => id !== selfId).map(([, c]) => c));
  const available = PLAYER_COLORS.filter((c) => !takenByOthers.has(c));
  return (
    <section className="color-picker" aria-label="Your color">
      <button className="color-current" aria-expanded={open} aria-label="Your color: tap to change" onClick={() => setOpen(!open)}>
        <span className="color-swatch selected" style={{ background: mine }} />
        <span className="muted">Your color {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="color-grid" role="radiogroup" aria-label="Pick your color">
          {available.map((color) => (
            <button key={color} role="radio" aria-checked={color === mine} aria-label={`Color ${color}`}
              className={color === mine ? 'color-swatch selected' : 'color-swatch'} style={{ background: color }}
              onClick={() => { if (color !== mine) onPick(color); setOpen(false); }} />
          ))}
        </div>
      )}
    </section>
  );
}
