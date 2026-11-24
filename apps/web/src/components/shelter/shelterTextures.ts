/**
 * The painted textures of the Zoo Adoption shelter, drawn once on canvases (no image files): the pebbled floor, the jungle mural on the walls, and the carpet pattern of the hand-over pads.
 * Each function returns a plain canvas; the scene wraps it in a texture.
 */

/** A small seeded random number generator, so a texture looks the same every time. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

// ---------------------------------------------------------------------------------------------- the floor

/**
 * Pebbled tile, like the floors of some office buildings: a pale tile (two by two tiles in one picture, with thin grout lines) with small pebbles sparsely
 * set in it, each a little oval in a stone color with a soft shadow and a glint. The picture repeats seamlessly. It covers 8 x 8 units of floor.
 */
export function makeFloorCanvas(): HTMLCanvasElement {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = seeded(41);
  g.fillStyle = '#d6d8da';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 110; i++) { // faint mottling in the tile itself
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(70,76,84,0.035)';
    g.fillRect(rnd() * S, rnd() * S, 24 + rnd() * 70, 24 + rnd() * 70);
  }
  g.fillStyle = '#b9bdc2'; // grout between the four tiles
  for (const p of [0, S / 2]) { g.fillRect(p - 1.5, 0, 3, S); g.fillRect(S - 1.5, 0, 3, S); g.fillRect(0, p - 1.5, S, 3); g.fillRect(0, S - 1.5, S, 3); }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (const p of [S / 2 + 2, 2]) { g.fillRect(p, 0, 1, S); g.fillRect(0, p, S, 1); }

  const stones = ['#9aa0a7', '#8b9097', '#b3aa9e', '#c4bcaf', '#7d838a', '#dadde0', '#a89f94', '#6f757c'];
  const placed: [number, number][] = [];
  const ellipse = (x: number, y: number, rx: number, ry: number, rot: number, fill: string) => {
    g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill();
  };
  for (let tries = 0; tries < 2600 && placed.length < 300; tries++) {
    const x = rnd() * S, y = rnd() * S;
    if (placed.some(([px, py]) => { const dx = Math.min(Math.abs(px - x), S - Math.abs(px - x)), dy = Math.min(Math.abs(py - y), S - Math.abs(py - y)); return dx * dx + dy * dy < 20 * 20; })) continue; // sparse: no two close together
    placed.push([x, y]);
    const rx = 3 + rnd() * 4.2, ry = rx * (0.55 + rnd() * 0.4), rot = rnd() * Math.PI, color = stones[Math.floor(rnd() * stones.length)];
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { // (drawn again across the edges so the picture tiles without a seam)
      const px = x + ox, py = y + oy;
      if (px < -12 || px > S + 12 || py < -12 || py > S + 12) continue;
      ellipse(px + 1.3, py + 1.6, rx, ry, rot, 'rgba(60,66,72,0.3)'); // a soft shadow
      ellipse(px, py, rx, ry, rot, color); // the pebble
      ellipse(px - rx * 0.28, py - ry * 0.32, rx * 0.45, ry * 0.38, rot, 'rgba(255,255,255,0.42)'); // a glint
    }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------- the jungle mural

function leaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, angle: number, fill: string) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.5, -wid, len, 0);
  g.quadraticCurveTo(len * 0.5, wid, 0, 0);
  g.fill();
  g.strokeStyle = 'rgba(0,40,20,0.22)'; // the vein down the middle
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.92, 0); g.stroke();
  g.restore();
}

/**
 * A flat painted jungle: layers of leaf-green canopy, tall trees, palms with fronds, big broad leaves along the bottom, hanging vines, a few flowers and small
 * parrots perched among the leaves. All solid colors (no shading), like a mural. It repeats seamlessly sideways and covers 64 x 16 units of wall.
 */
export function makeJungleCanvas(): HTMLCanvasElement {
  const W = 1024, H = 256;
  const [c, g] = canvas(W, H);
  const rnd = seeded(9);
  const wrap = (fn: (dx: number) => void) => { for (const dx of [-W, 0, W]) fn(dx); };
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];

  g.fillStyle = '#cde9c5'; g.fillRect(0, 0, W, H); // a pale green-yellow sky behind everything
  g.fillStyle = '#e4f3d4'; g.fillRect(0, 0, W, 70);
  for (let i = 0; i < 26; i++) { const x = rnd() * W, y = 150 + rnd() * 30, r = 24 + rnd() * 26; wrap((dx) => { g.fillStyle = '#7cc08f'; g.beginPath(); g.arc(x + dx, y, r, 0, Math.PI * 2); g.fill(); }); } // far canopy
  for (let i = 0; i < 30; i++) { const x = rnd() * W, y = 175 + rnd() * 34, r = 22 + rnd() * 26; wrap((dx) => { g.fillStyle = '#3f9a63'; g.beginPath(); g.arc(x + dx, y, r, 0, Math.PI * 2); g.fill(); }); } // nearer canopy

  for (let i = 0; i < 9; i++) { // tall trees: a trunk with a round crown of leaves
    const x = (i + rnd() * 0.6) * (W / 9), top = 70 + rnd() * 50;
    wrap((dx) => {
      g.fillStyle = '#7b5a3a'; g.fillRect(x + dx - 6, top, 12, H - top);
      g.fillStyle = '#6a4c30'; g.fillRect(x + dx + 1, top, 5, H - top);
      for (const [ox, oy, r, col] of [[0, 0, 40, '#2f8a52'], [-30, 16, 30, '#2a7a49'], [30, 14, 32, '#38985c'], [4, -26, 28, '#3da363']] as const) {
        g.fillStyle = col; g.beginPath(); g.arc(x + dx + ox, top + oy, r, 0, Math.PI * 2); g.fill();
      }
    });
  }

  for (let i = 0; i < 7; i++) { // palm trees: a curved trunk and a burst of fronds
    const x = rnd() * W, lean = (rnd() - 0.5) * 70, top = 56 + rnd() * 40;
    wrap((dx) => {
      g.strokeStyle = '#8a6a44'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + dx, H); g.quadraticCurveTo(x + dx + lean * 0.2, (H + top) / 2, x + dx + lean, top); g.stroke();
      for (let k = 0; k < 8; k++) leaf(g, x + dx + lean, top, 62 + rnd() * 26, 13, -Math.PI / 2 + (k - 3.5) * 0.52 + (rnd() - 0.5) * 0.2, pick(['#2e9e5b', '#3fb86a', '#26864c']));
    });
  }

  for (let i = 0; i < 26; i++) { // big broad leaves rising from the bottom
    const x = rnd() * W, len = 80 + rnd() * 80, ang = -Math.PI / 2 + (rnd() - 0.5) * 1.9;
    wrap((dx) => leaf(g, x + dx, H + 6, len, 26 + rnd() * 14, ang, pick(['#1f7a45', '#2a9457', '#3aa866', '#15663a', '#47b574'])));
  }

  for (let i = 0; i < 16; i++) { // vines hanging from the top, with a few leaves on them
    const x = rnd() * W, len = 60 + rnd() * 90;
    wrap((dx) => {
      g.strokeStyle = '#1c6b3d'; g.lineWidth = 3;
      g.beginPath();
      for (let y = 0; y <= len; y += 6) g.lineTo(x + dx + Math.sin(y * 0.09 + x) * 6, y);
      g.stroke();
      for (let y = 18; y < len; y += 22) leaf(g, x + dx + Math.sin(y * 0.09 + x) * 6, y, 20, 7, (y % 2 ? 0.5 : Math.PI - 0.5) + 0.6, '#2f9d5a');
    });
  }

  for (let i = 0; i < 34; i++) { // flowers
    const x = rnd() * W, y = 150 + rnd() * 96, r = 6 + rnd() * 5, col = pick(['#ff6b6b', '#ffd23f', '#ff8fb1', '#ffffff', '#ff9f43']);
    wrap((dx) => {
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.fillStyle = col; g.beginPath(); g.arc(x + dx + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r * 0.7, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(x + dx, y, r * 0.55, 0, Math.PI * 2); g.fill();
    });
  }

  for (let i = 0; i < 7; i++) { // small parrots perched among the leaves
    const x = rnd() * W, y = 120 + rnd() * 70, [body, wing] = pick([['#e23b3b', '#2f6fe0'], ['#2fbf4a', '#f4d03f'], ['#2f6fe0', '#f4d03f'], ['#f08a3a', '#2fbf4a']]);
    wrap((dx) => {
      const X = x + dx;
      g.fillStyle = wing; g.beginPath(); g.ellipse(X - 14, y + 20, 5, 17, 0.3, 0, Math.PI * 2); g.fill(); // tail
      g.fillStyle = body; g.beginPath(); g.ellipse(X, y, 13, 19, 0, 0, Math.PI * 2); g.fill(); // body
      g.beginPath(); g.arc(X + 4, y - 20, 10, 0, Math.PI * 2); g.fill(); // head
      g.fillStyle = wing; g.beginPath(); g.ellipse(X - 3, y + 2, 6, 13, 0.15, 0, Math.PI * 2); g.fill(); // wing
      g.fillStyle = '#f2e6c4'; g.beginPath(); g.moveTo(X + 12, y - 22); g.lineTo(X + 24, y - 16); g.lineTo(X + 12, y - 12); g.fill(); // beak
      g.fillStyle = '#14161c'; g.beginPath(); g.arc(X + 6, y - 23, 2.2, 0, Math.PI * 2); g.fill(); // eye
    });
  }

  g.fillStyle = '#14532e'; g.fillRect(0, H - 22, W, 22); // dark undergrowth along the bottom
  for (let x = 0; x < W; x += 14) { g.beginPath(); g.moveTo(x, H - 22); g.lineTo(x + 7, H - 36 - rnd() * 14); g.lineTo(x + 14, H - 22); g.fill(); }
  return c;
}

// ---------------------------------------------------------------------------------------------- the hand-over carpets

/**
 * A carpet in shades of grey (the scene tints it any color): a fringe at each short end, a border of bands, a field of diamonds and a medallion in the middle.
 * It is wider than it is tall (14 x 5 units) and the picture is the same shape.
 */
export function makeCarpetCanvas(): HTMLCanvasElement {
  const W = 560, H = 200;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#cfcfcf'; // fringe along the two short ends
  for (let y = 4; y < H - 2; y += 9) { g.fillRect(0, y, 14, 4); g.fillRect(W - 14, y, 14, 4); }
  const rect = (inset: number, color: string) => { g.fillStyle = color; g.fillRect(14 + inset, inset, W - 28 - inset * 2, H - inset * 2); };
  rect(0, '#8a8a8a'); // the outer band
  rect(10, '#f6f6f6');
  rect(17, '#aaaaaa');
  rect(27, '#f0f0f0');
  rect(33, '#c4c4c4'); // the field
  // the field: a lattice of diamonds
  g.save();
  g.beginPath(); g.rect(14 + 33, 33, W - 28 - 66, H - 66); g.clip();
  const step = 34;
  for (let cx = 14 + 33; cx < W - 14 - 33 + step; cx += step) {
    for (let cy = 33; cy < H - 33 + step; cy += step) {
      const odd = (Math.round((cx - 47) / step) + Math.round((cy - 33) / step)) % 2 === 0;
      g.fillStyle = odd ? '#f4f4f4' : '#a6a6a6';
      g.beginPath(); g.moveTo(cx, cy - step / 2 + 3); g.lineTo(cx + step / 2 - 3, cy); g.lineTo(cx, cy + step / 2 - 3); g.lineTo(cx - step / 2 + 3, cy); g.closePath(); g.fill();
    }
  }
  // the medallion in the middle
  const mx = W / 2, my = H / 2;
  for (const [r, color] of [[70, '#8a8a8a'], [58, '#f4f4f4'], [44, '#9c9c9c'], [30, '#efefef'], [15, '#8a8a8a']] as const) {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(mx, my - r); g.lineTo(mx + r * 1.5, my); g.lineTo(mx, my + r); g.lineTo(mx - r * 1.5, my); g.closePath(); g.fill();
  }
  g.restore();
  return c;
}
