/**
 * Small inline icons (GAME_RULES.md #20: the UI never uses emojis, which look different on every device and clash with the rest). Each is a simple shape drawn in the current text color and
 * sized to the text around it, so it can sit in a sentence or a button.
 */
const PATHS: Record<string, string> = {
  trophy: 'M6 3h12v3h3v2a5 5 0 0 1-5 5h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 13H8a5 5 0 0 1-5-5V6h3V3zM5 8a3 3 0 0 0 2 2.8V8H5zm14 0h-2v2.8A3 3 0 0 0 19 8z',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z',
  lock: 'M6 10V8a6 6 0 0 1 12 0v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h8V8a4 4 0 0 0-8 0v2z',
  fish: 'M2 12c3-5 8-6 12-3l5-3v12l-5-3c-4 3-9 2-12-3zm10-2a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 12 10z',
  bag: 'M9 3h6a2 2 0 0 1 2 2v1a5 5 0 0 1 3 4.6V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9.4A5 5 0 0 1 7 6V5a2 2 0 0 1 2-2zm1 2v1h4V5h-4z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6l1-8z',
  eye: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  alert: 'M12 3l10 18H2L12 3zm-1 7v5h2v-5h-2zm0 7v2h2v-2h-2z',
  sliders: 'M4 6h9v2H4V6zm11 0h5v2h-5V6zm-2-2v6h2V4h-2zM4 16h5v2H4v-2zm7 0h9v2h-9v-2zM9 14v6h2v-6H9z',
  check: 'M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5L9 16.2z',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <path fillRule="evenodd" d={PATHS[name]} />
    </svg>
  );
}
