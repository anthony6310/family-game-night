import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  image?: string; // the game's picture (files in public/games), if it has one
  /**
   * Once the round has begun: the server's moment (server clock) when every phone lifts the page (RoomState.revealAt). Until then the page covers the game, which is being built under it;
   * at that moment it fades away. `onGone` is called when it has finished.
   */
  revealAt?: number | null;
  serverNow?: () => number;
  onGone?: () => void;
}

/**
 * The loading page between the countdown and the game: the game's picture and title on the flash's pale color. It fades its content in as the flash fades away, covers the game while
 * every phone builds it, and fades itself out at the round's reveal moment, so the change into the game is a cross-fade and not a cut (see GAME_RULES.md #8).
 */
export function StartingScreen({ title, image, revealAt = null, serverNow, onGone }: Props) {
  // The fade starts at `revealAt` on the SERVER's clock, the same moment on every phone, and not when this phone happened to get the message (a phone on Wi-Fi can get it a tenth of a second
  // or more after a laptop next to the server). The server announces it a little ahead (REVEAL_LEAD_MS) so the message is normally there first; a late one fades at once.
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (revealAt === null || !serverNow) { setFading(false); return; }
    const wait = revealAt - serverNow();
    if (wait <= 0) { setFading(true); return; }
    const id = window.setTimeout(() => setFading(true), wait);
    return () => window.clearTimeout(id);
  }, [revealAt, serverNow]);
  // The page scrolls under it in the lobby and not in a game, so the page's scrollbar would appear or disappear at the moment the game loads and shift everything by its width
  // (that was the jump). Scrolling is switched off for as long as this page exists: the scrollbar is already gone, and stays gone, before the game is drawn.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = before; };
  }, []);
  // It is drawn straight into <body> (a portal), outside the lobby's layout, on a layer above the game (see the z-index in styles.css), so nothing under it can move it.
  return createPortal(
    <div className={`starting-screen${fading ? ' leaving' : ''}`} onAnimationEnd={(e) => { if (fading && e.target === e.currentTarget) onGone?.(); }}>
      {image && <img className="starting-art" src={image} alt="" decoding="sync" draggable={false} />}
      <p>{title}</p>
    </div>,
    document.body,
  );
}
