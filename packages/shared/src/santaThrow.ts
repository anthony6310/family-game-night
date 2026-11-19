/**
 * How a throw flies in Santa's Sack, as pure sums shared by the server (which simulates it) and the phones (which draw where the player's pull would send the gift).
 */
export interface SantaLobParams {
  throwSpeed: number; // how fast a gift flies sideways (units per second) in a direct flight: farther throws take longer
  flightMinMs: number; // no flight is shorter than this
  gravity: number; // the gravity the flight times are worked out from (units per second squared, negative = down)
  handHeight: number; // a gift leaves the elf's hands this high
  aimHeight: number; // a throw is aimed at a point this high in the air (a little above the bags' mouths): the gift passes through it on its way down
  lobFactor: number; // the arc peaks this many times as high as a direct flight over the same distance would
  baseLobFactor: number; // the flight time is measured from a lob this high...
  flightTimeScale: number; // ...and then scaled by this (0.65 = 35% shorter)
}

/**
 * How a throw to a spot `range` away flies: its launch speed up (vy), its own gravity (g, a positive number) and the flight time in seconds (to the aim height, on the way down).
 * To be both high AND quick, each throw has its own gravity: from the peak height h (above the hands) and the time T, falling from the peak to the aim height gives
 * T = (sqrt(2h) + sqrt(2 (h - aim))) / sqrt(g), so g = ((sqrt(2h) + sqrt(2 (h - aim))) / T)^2, and the launch speed up is sqrt(2 g h).
 */
export function lobPlan(p: SantaLobParams, range: number) {
  const g0 = -p.gravity;
  const aim = p.aimHeight - p.handHeight; // the aim point is this far above the hands
  const direct = Math.max(p.flightMinMs, (range / p.throwSpeed) * 1000) / 1000;
  const directRise = Math.pow((aim + 0.5 * g0 * direct * direct) / direct, 2) / (2 * g0);
  const baseRise = directRise * p.baseLobFactor;
  const baseTime = Math.sqrt(2 * g0 * baseRise) / g0 + Math.sqrt((2 * Math.max(0, baseRise - aim)) / g0);
  const rise = directRise * p.lobFactor;
  const flight = baseTime * p.flightTimeScale;
  const g = Math.pow((Math.sqrt(2 * rise) + Math.sqrt(2 * Math.max(0, rise - aim))) / flight, 2);
  return { rise, flight, g, vy: Math.sqrt(2 * g * rise) };
}
