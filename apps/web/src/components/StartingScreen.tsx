import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  image?: string; // the game's picture (files in public/games), if it has one
  /** Set once the round has begun: the page is then laid over the game and fades away. `onGone` is called when it has finished. */
  leaving?: boolean;
  onGone?: () => void;
}

/**
 * The loading page between the countdown and the game: the game's picture and title on the flash's pale color. It fades its content in as the flash fades
 * away, and (when `leaving`) fades itself out over the game, so the change into the game is a cross-fade and not a cut (see GAME_RULES.md #8).
 */
export function StartingScreen({ title, image, leaving = false, onGone }: Props) {
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
    <div className={`starting-screen${leaving ? ' leaving' : ''}`} onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onGone?.(); }}>
      {image && <img className="starting-art" src={image} alt="" decoding="sync" draggable={false} />}
      <p>{title}</p>
    </div>,
    document.body,
  );
}
