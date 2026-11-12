import type { RoundResult } from '@fgn/shared';

type Outcome = 'won' | 'lost' | 'draw' | 'watching';

/** What this player should be told: did they win, lose, draw, or were they just watching (e.g. a tie-breaker they weren't in)? */
function outcomeFor(result: RoundResult, selfId: string | null): Outcome {
  if (selfId === null || !(selfId in result.scores)) return 'watching';
  if (result.winnerId === null) return 'draw';
  return result.winnerId === selfId ? 'won' : 'lost';
}

const COPY: Record<Outcome, { headline: string; sub: string }> = {
  won: { headline: 'YOU WON!', sub: 'Nailed it! 🏆' },
  lost: { headline: 'YOU LOST!', sub: 'Better luck next time!' },
  draw: { headline: "IT'S A DRAW!", sub: 'Nobody wins this one' },
  watching: { headline: 'ROUND OVER!', sub: 'And that is that!' },
};

/**
 * The short sequence shown over the frozen game when a round ends, before the summary screen.
 * The message follows a gentle arc and bobs up and down. The overlay also covers the screen, so nothing
 * underneath can be tapped: player input is stopped (the server ignores it during this phase too).
 */
export function FinishOverlay({ result, selfId }: { result: RoundResult; selfId: string | null }) {
  const outcome = outcomeFor(result, selfId);
  const { headline, sub } = COPY[outcome];
  // Shrink long messages so they always fit on their arc.
  const mainSize = Math.min(100, Math.floor(520 / (headline.length * 0.62)));
  const subSize = Math.min(40, Math.floor(420 / (sub.length * 0.55)));

  return (
    <div className="finish-overlay" role="alert" aria-live="assertive">
      <div className="finish-pop">
        <div className="finish-bob">
          <svg className={`finish-svg ${outcome}`} viewBox="0 0 600 340" aria-label={`${headline} ${sub}`}>
            <defs>
              {/* Two shallow arcs: a little curve is enough to make the text feel playful. */}
              <path id="finish-arc-main" d="M 30 190 Q 300 80 570 190" fill="none" />
              <path id="finish-arc-sub" d="M 100 295 Q 300 255 500 295" fill="none" />
            </defs>
            <text className="finish-main" fontSize={mainSize}>
              <textPath href="#finish-arc-main" startOffset="50%" textAnchor="middle">{headline}</textPath>
            </text>
            <text className="finish-sub" fontSize={subSize}>
              <textPath href="#finish-arc-sub" startOffset="50%" textAnchor="middle">{sub}</textPath>
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}
