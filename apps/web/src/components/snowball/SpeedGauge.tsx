import type { SnowballBall, SnowballView } from '@fgn/shared';

interface Props {
  ball: SnowballBall; // your own ball, from the latest server snapshot
  range: SnowballView['speedRange'];
}

/**
 * The speedometer: how fast you are rolling, in world units (metres) per second.
 *  - the fill is your CURRENT speed; the white marker is the top speed you are heading toward right now
 *    (normal speed, nudged by the hill you're on and by the escape boost);
 *  - the ticks are the slowest possible, normal, fastest-from-hills and fastest-possible top speeds;
 *  - chips say what is helping or hurting: the ground (with its stack count), the escape boost you
 *    get for 2 s after hitting a bigger ball, and the crown (the biggest ball hits twice as hard).
 * Everything shown comes straight from the server's numbers, so it is also the way to check the speed mechanics.
 */
export function SpeedGauge({ ball, range }: Props) {
  const speed = Math.hypot(ball.vx, ball.vz);
  const topNow = range.base * ball.speedFactor;
  const scaleMax = range.max * 1.04; // a little headroom past the fastest tick
  const at = (value: number) => `${Math.max(0, Math.min(100, (value / scaleMax) * 100))}%`;

  const percent = Math.round((ball.speedFactor - 1) * 100); // net effect, everything included
  const mood = percent > 0 ? 'boost' : percent < 0 ? 'slow' : 'normal';
  const hillPercent = Math.round((ball.hillFactor - 1) * 100); // the ground's share of it
  const stacks = hillPercent > 0 ? ball.boostStacks : ball.slowStacks;
  const escapePercent = Math.round(range.escapeBonus * 100);

  return (
    <div className={`speedo ${mood}`} role="meter" aria-label="Speed" aria-valuemin={0} aria-valuemax={Math.round(range.max * 10) / 10}
      aria-valuenow={Math.round(speed * 10) / 10} aria-valuetext={`${speed.toFixed(1)} metres per second`}>
      <div className="speedo-top">
        <span className="speedo-value">{speed.toFixed(1)}<small> m/s</small></span>
        <span className="speedo-chips">
          {ball.leader && <span className="speedo-chip crown" title="You are the biggest ball: your hits do double damage">👑 Biggest</span>}
          {ball.escape && <span className="speedo-chip escape" title="You hit a bigger ball: extra speed for 2 seconds">⚡ Escape +{escapePercent}%</span>}
          {hillPercent !== 0 && (
            <span className={`speedo-chip ${hillPercent > 0 ? 'down' : 'up'}`} title={`${stacks} ${hillPercent > 0 ? 'boost' : 'slow'} stack${stacks === 1 ? '' : 's'}`}>
              {hillPercent > 0 ? '▲ Downhill +' : '▼ Uphill −'}{Math.abs(hillPercent)}%
              <small> · {stacks}</small>
            </span>
          )}
        </span>
      </div>
      <div className="speedo-track">
        <div className="speedo-fill" style={{ width: at(speed) }} />
        {[range.min, range.base, range.hillMax, range.max].map((tick) => (
          <span key={tick} className="speedo-tick" style={{ left: at(tick) }} />
        ))}
        <span className="speedo-target" style={{ left: at(topNow) }} title="Top speed right now" />
      </div>
      <div className="speedo-scale">
        {/* Labels hang off their ticks in different directions so the close-together 90% and 100% never overlap. */}
        <span className="to-left" style={{ left: at(range.min) }}>{Math.round((range.min / range.base) * 100)}%</span>
        <span className="to-right" style={{ left: at(range.base) }}>100%</span>
        <span className="to-left" style={{ left: at(range.hillMax) }}>{Math.round((range.hillMax / range.base) * 100)}%</span>
        <span className="to-left" style={{ left: at(range.max) }}>{Math.round((range.max / range.base) * 100)}%</span>
      </div>
    </div>
  );
}
