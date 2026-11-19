// TEMPORARY bow harness (delete after use): the cinched sack at its game angle from three angles (front, side, top), with sliders that turn the bow about ITS OWN axes.
import { AmbientLight, CylinderGeometry, DirectionalLight, Color, HemisphereLight, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Euler, Vector3 } from 'three';
import { BAG_TILT } from '@fgn/shared';
import { SantaSackScene } from './components/santa/SantaSackScene';

const s: any = new SantaSackScene(document.getElementById('c')!, () => 0, {}, null);
s.disposed = true; cancelAnimationFrame(s.rafId);
s.latest = { orbit: { radius: 12, speed: 3 }, stations: {} };
s.orbitAt = () => ({ x: 0, z: 0, angle: 0 });
s.scene.background = new Color('#2b3548');
s.scene.add(new HemisphereLight(0xffffff, 0x667788, 1.8), new AmbientLight(0xffffff, 0.4));
const sun = new DirectionalLight(0xffffff, 1.4); sun.position.set(3, 8, 10); s.scene.add(sun);
const v = s.addBag({ id: 1, radius: 1, slot: 0, leader: null, gifts: [], lid: { closeAt: 0, openAt: 0 } });
s.shapeBag(v, 1);
v.haloMesh.visible = false; v.group.position.set(0, 0, 0); v.heap.visible = false;
v.tilt.rotation.x = BAG_TILT; // (the lean it has in the game)
// the bow's own axes as coloured lines (children of the bow: they turn with it)
const g0 = v.bowGroup.quaternion.clone();
for (const [col, d] of [['#ff3b3b', [1, 0, 0]], ['#3bff3b', [0, 1, 0]], ['#4d8dff', [0, 0, 1]]] as [string, number[]][]) {
  const m = new Mesh(new CylinderGeometry(0.01, 0.01, 1.4, 6), new MeshBasicMaterial({ color: col, depthTest: false }));
  m.renderOrder = 999; m.position.set(d[0] * 0.7, d[1] * 0.7, d[2] * 0.7);
  if (d[0]) m.rotation.z = Math.PI / 2; if (d[2]) m.rotation.x = Math.PI / 2;
  v.bowGroup.add(m);
}
const ids = ['rx', 'ry', 'rz'] as const;
const els: Record<string, HTMLInputElement> = {}, outs: Record<string, HTMLOutputElement> = {};
for (const id of ids) { els[id] = document.getElementById(id) as HTMLInputElement; outs[id] = document.getElementById(id + 'v') as HTMLOutputElement; }
const apply = () => {
  const d = Math.PI / 180;
  const delta = new Quaternion().setFromEuler(new Euler(+els.rx.value * d, 0, 0)).multiply(new Quaternion().setFromEuler(new Euler(0, +els.ry.value * d, 0))).multiply(new Quaternion().setFromEuler(new Euler(0, 0, +els.rz.value * d)));
  v.bowGroup.quaternion.copy(g0).multiply(delta); // (turned about the bow's own axes)
  for (const id of ids) outs[id].textContent = els[id].value;
  (document.getElementById('read') as HTMLElement).textContent = `bow turn  x ${els.rx.value}   y ${els.ry.value}   z ${els.rz.value}  (degrees)`;
};
for (const id of ids) els[id].oninput = apply;
(document.getElementById('reset') as HTMLElement).onclick = () => { for (const id of ids) els[id].value = '0'; apply(); };
apply();

const O = document.getElementById('o') as HTMLCanvasElement, g = O.getContext('2d')!;
const HALF_H = 2.1, CY = 1.3;
function draw() {
  const host = document.getElementById('c')!, W = host.clientWidth, H = host.clientHeight, r = s.renderer;
  r.setSize(W, H); O.width = W; O.height = H; g.clearRect(0, 0, W, H);
  r.setScissorTest(true);
  const cw = W / 3, ppu = Math.min(H / (2 * HALF_H), cw / 4.4);
  v.group.updateMatrixWorld(true);
  const bowAt = new Vector3(); v.bowPivot.getWorldPosition(bowAt);
  ([['FRONT (from outside, down the Z line)', 'front'], ['SIDE (from the right, down the X line)', 'side'], ['TOP (from above, down the Y line)', 'top']] as const).forEach(([name, side], i) => {
    const x = i * cw;
    const cam = new OrthographicCamera(-cw / 2 / ppu, cw / 2 / ppu, H / 2 / ppu, -H / 2 / ppu, 0.1, 100);
    if (side === 'front') { cam.position.set(0, CY, 20); cam.up.set(0, 1, 0); cam.lookAt(0, CY, 0); }
    else if (side === 'side') { cam.position.set(20, CY, 0); cam.up.set(0, 1, 0); cam.lookAt(0, CY, 0); }
    else { cam.position.set(bowAt.x, 20, bowAt.z); cam.up.set(0, 0, -1); cam.lookAt(bowAt.x, 0, bowAt.z); }
    r.setViewport(x, 0, cw, H); r.setScissor(x, 0, cw, H); r.render(s.scene, cam);
    g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(x, 0, cw, H);
    g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.fillText(name, x + 10, 20);
  });
  r.setScissorTest(false);
}
const loop = () => { draw(); requestAnimationFrame(loop); }; loop();
