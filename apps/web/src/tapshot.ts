// TEMPORARY preview (delete after use): every kind of fish with its catch box. GREEN = the new box (over the head, as tall as the body, scaled with the fish); RED = the old box (before the sketch).
import { AmbientLight, BufferGeometry, Color, DirectionalLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { FISH_LENGTH, FishKit } from './components/snowball/fish';

const BACK = 0.65, BIG_BACK = 0.39, FRONT = 0, HALF_H = 0.221; // (fractions of the fish's length: the new box reaches back from the nose, a little past it, and is as tall as the body)
const OLD = { x: 0.45, y: 0.5625, bx: 0.525, by: 0.62 }; // (the old box: centred on the nose, the same size for every fish)
const kits = { school: new FishKit({ body: '#9fd8ff', fin: '#4f9fe0', eyes: 'round' }), regular: new FishKit({ body: '#ff8a3d', fin: '#ff6a2b', eyes: 'round' }), big: new FishKit({ body: '#2f3f9e', fin: '#e0407a', eyes: 'round' }) };
const fish = [
  { kind: 'school', size: 0.75, x: -9, y: 3.2 }, { kind: 'school', size: 1.05, x: -4, y: 3.2 }, { kind: 'regular', size: 1.3, x: 1.5, y: 3.2 }, { kind: 'regular', size: 2.0, x: 7, y: 3.2 },
  { kind: 'regular', size: 2.6, x: -7, y: -2.6 }, { kind: 'big', size: 3.6, x: 1, y: -2.6 },
] as const;

const renderer = new WebGLRenderer({ antialias: true });
document.getElementById('c')!.appendChild(renderer.domElement);
const scene = new Scene(); scene.background = new Color('#14527f');
scene.add(new AmbientLight('#ffffff', 1.4), new DirectionalLight('#ffffff', 1.2));
const W = 24;
const cam = new OrthographicCamera(-W / 2, W / 2, 7, -7, 0.1, 50); cam.position.set(0, 0, 20);
const resize = () => { const w = innerWidth, h = innerHeight; renderer.setSize(w, h); const half = (W / 2) * (h / w); cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix(); };
resize(); addEventListener('resize', resize);

const box = (cx: number, cy: number, hx: number, hy: number, color: string, fill: boolean) => {
  const pts = [new Vector3(cx - hx, cy - hy, 1), new Vector3(cx + hx, cy - hy, 1), new Vector3(cx + hx, cy + hy, 1), new Vector3(cx - hx, cy + hy, 1), new Vector3(cx - hx, cy - hy, 1)];
  scene.add(new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color })));
  if (fill) { const m = new Mesh(new PlaneGeometry(hx * 2, hy * 2), new MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthTest: false })); m.position.set(cx, cy, 1); scene.add(m); }
};
for (const f of fish) {
  const model = kits[f.kind].create();
  model.scale.setScalar(f.size / FISH_LENGTH);
  model.position.set(f.x, f.y, 0);
  scene.add(model);
  const nose = f.x + f.size / 2; // (the fish faces right: its nose is half a length ahead of its middle)
  const o = f.kind === 'big' ? { x: OLD.bx, y: OLD.by } : { x: OLD.x, y: OLD.y };
  box(nose, f.y, o.x, o.y, '#ff5a5a', false); // the old box
  const lo = nose - (f.kind === 'big' ? BIG_BACK : BACK) * f.size, hi = nose + FRONT * f.size;
  box((lo + hi) / 2, f.y, (hi - lo) / 2, HALF_H * f.size, '#3dff7a', true); // the new box
}
document.getElementById('t')!.innerHTML = '<b>Fish catch boxes</b> (relative to each fish: the same shape on every one, scaled with its length)<br><span style="color:#3dff7a">GREEN = the new box</span>: over the head, from 65% of the length back from the nose up to the tip of the lips (its front edge is the nose), 22.1% of the length above and below; the BIG fish\'s box is 40% narrower (39% of its length), still ending at its lips · <span style="color:#ff7a7a">RED = the old box (before the sketch)</span><br>top row: school 0.75, school 1.05, regular 1.3, regular 2.0 · bottom row: regular 2.6, big 3.6 (fish length)';
renderer.setAnimationLoop(() => renderer.render(scene, cam));
