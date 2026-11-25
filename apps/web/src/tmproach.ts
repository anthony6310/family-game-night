// TEMPORARY staging page for Roach Rumble (delete when done). ?as=sandal|roach|b  ?smack=1 (the sandal smacks on its own)  ?still=1 (nobody moves)  ?seed=N (the kitchen)  ?starve=N (roach b has N seconds of life and stands still)  ?poison=N (the bottle breaks N seconds in)  ?near=bottle|can (the roach 'a' starts there)
import { type RoachHuntView } from '@fgn/shared';
import { createRoachHunt } from '../../server/src/games/roachHunt';
import { RoachScene } from './components/roach/RoachScene';
const params = new URLSearchParams(location.search);
const as = params.get('as') ?? 'roach';
const ids = ['s', 'a', 'b', 'c', 'd'];
const eng = createRoachHunt({ durationMs: 600_000, seed: Number(params.get('seed') ?? Math.floor(Math.random() * 1e6)) });
const startsAt = Date.now() - 3000 - Number(params.get('at') ?? 0) * 1000; // ?at=N: N seconds into the round (the lights come on at 15, 30, ...)
const state = eng.init(ids, startsAt, { teams: { s: 'purple', a: 'yellow', b: 'yellow', c: 'yellow', d: 'yellow' } });
const styles = { s: { name: 'Sam', color: '#8e44ad' }, a: { name: 'You', color: '#ffd23d' }, b: { name: 'Bea', color: '#ff6b6b' }, c: { name: 'Cy', color: '#4cc9f0' }, d: { name: 'Dee', color: '#80ed99' } };
const me = as === 'sandal' ? 's' : as === 'b' ? 'b' : 'a';
const raw = state as unknown as { layout: { poison: { x: number; z: number; cx: number; cz: number }; trash: { x: number; z: number } }; poisonAt: number | null; players: Record<string, { life: number; x: number; z: number }>; foods: { x: number; z: number }[] };
if (params.get('foodin')) { raw.foods[0].x = raw.layout.poison.cx + 2.5; raw.foods[0].z = raw.layout.poison.cz + 2.5; } // ?foodin=1: a piece of food starts in the poison patch
if (params.get('starve')) raw.players.b.life = Number(params.get('starve'));
if (params.get('near') === 'food') { raw.players.a.x = raw.foods[0].x + 4; raw.players.a.z = raw.foods[0].z + 1.5; }
if (params.get('near') === 'bottle') { raw.players.a.x = raw.layout.poison.x + 4; raw.players.a.z = raw.layout.poison.z + 1; }
if (params.get('near') === 'poison') { raw.players.a.x = raw.layout.poison.cx + 3; raw.players.a.z = raw.layout.poison.cz + 3; }
if (params.get('poison')) setTimeout(() => { raw.poisonAt = Date.now(); }, Number(params.get('poison')) * 1000);
const scene = new RoachScene(document.getElementById('c')!, styles, me);
scene.serverNow = () => Date.now();
scene.canMove = true;
if (params.get('yaw')) scene.turnBy(Number(params.get('yaw'))); // ?yaw=radians: a roach turns its camera
if (params.get('top')) scene.introFactor = () => 0; // ?top=1: the whole room from high up
(window as unknown as Record<string, unknown>).__scene = scene; (window as unknown as Record<string, unknown>).__state = state; (window as unknown as Record<string, unknown>).__eng = eng;
let last = Date.now();
const wander: Record<string, number> = {};
setInterval(() => {
  const now = Date.now();
  if (!params.get('still')) {
    for (const id of ids) {
      if (id === me || (id === 'b' && params.get('starve'))) continue;
      if (id === 's') {
        const v = eng.view(state) as RoachHuntView;
        const tgt = Object.entries(v.players).find(([i, p]) => i !== 's' && p.alive)?.[1];
        if (tgt) { const dx = tgt.x - v.players.s.x, dz = tgt.z - v.players.s.z, d = Math.hypot(dx, dz) || 1; eng.reduce(state, 's', { type: 'steer', x: dx / d, z: dz / d }, now); if (d < 3.6 && params.get('smack')) eng.reduce(state, 's', { type: 'smack' }, now); }
      } else if (now > (wander[id] ?? 0)) { wander[id] = now + 500 + Math.random() * 1200; const a = Math.random() * 6.28; eng.reduce(state, id, { type: 'steer', x: Math.cos(a), z: Math.sin(a) }, now); }
    }
  }
  eng.reduce(state, me, { type: 'steer', x: 0, z: 0 }, now);
  eng.tick!(state, (now - last) / 1000, now); last = now;
  scene.pushView(eng.view(state) as RoachHuntView);
}, 25);

// the night-vision overlay the real screen draws (the classes are in styles.css, which the staging page does not load, so import it)
import './styles.css';
const nv = document.createElement('div'); nv.className = 'roach-nv'; nv.style.opacity = '0';
const dz = document.createElement('div'); dz.className = 'roach-dazzle'; dz.style.opacity = '0';
document.getElementById('c')!.append(nv, dz);
setInterval(() => { const v = scene.vision(); nv.style.opacity = String(v.nv); dz.style.opacity = String(v.dazzle * 0.85); }, 50);
