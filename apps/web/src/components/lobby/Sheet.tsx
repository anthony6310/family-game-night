import { useEffect, type ReactNode } from 'react';

/**
 * A bottom SHEET (GAME_RULES.md #19): a panel that slides up over the lobby with a title and a close button, so a menu opens without leaving the room. Tapping the dark area behind it or
 * pressing Escape closes it. On a wide screen it is a centered card instead.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-layer" role="presentation" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="sheet-close" aria-label="Close" onClick={onClose}>&times;</button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
