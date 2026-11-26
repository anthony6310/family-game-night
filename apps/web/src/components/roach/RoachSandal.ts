import { BufferGeometry, ExtrudeGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Shape } from 'three';
import { Model } from '../shelter/AnimalKit';

type V3 = [number, number, number];

/**
 * The sandal from the sketch: ONE solid, softly rounded slab (a squarer heel, a rounder toe, no layers), and a Y of two straps that meet at the toe post: seen from the side a low triangle, peaking at the toe post
 * about 70% of the way along. Faces +z. About 4.1 long and 1.65 wide, 0.46 thick.
 */
export function buildSandal(sole = '#3a7bd5', strap = '#f4f4f4'): BufferGeometry {
  const m = new Model();
  const W = 0.75, L = 1.97, rh = 0.38, rt = 0.74; // (the outline, before the bevel rounds it off by 0.08 all round)
  const sh = new Shape();
  sh.moveTo(-L + rh, -W); sh.lineTo(L - rt, -W); sh.quadraticCurveTo(L, -W, L, -W + rt); sh.lineTo(L, W - rt); sh.quadraticCurveTo(L, W, L - rt, W);
  sh.lineTo(-L + rh, W); sh.quadraticCurveTo(-L, W, -L, W - rh); sh.lineTo(-L, -W + rh); sh.quadraticCurveTo(-L, -W, -L + rh, -W);
  const slab = new ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 10 });
  slab.applyMatrix4(new Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0.08, 1, 0, 0, 0, 0, 0, 0, 1)); // shape x -> along z (length), shape y -> across x, the extrusion -> up y; bottom on the floor
  const g = new Group(); g.add(new Mesh(slab, new MeshStandardMaterial({ color: sole })));
  m.group(g);
  slab.dispose();
  const top = 0.46, peak: V3 = [0, top + 0.5, 0.86];
  const cord = (from: V3, ctrl: V3, to: V3, r: number) => { // a strap: a smooth curve of short rods
    let prev = from;
    for (let i = 1; i <= 36; i++) {
      const t = i / 36, u = 1 - t, p: V3 = [u * u * from[0] + 2 * u * t * ctrl[0] + t * t * to[0], u * u * from[1] + 2 * u * t * ctrl[1] + t * t * to[1], u * u * from[2] + 2 * u * t * ctrl[2] + t * t * to[2]];
      m.limb(strap, prev, p, r); prev = p;
    }
  };
  for (const side of [-1, 1]) cord([side * 0.74, top - 0.04, -0.15], [side * 0.42, top + 0.36, 0.3], peak, 0.085); // the two arms, from the sides of the sole up to the toe post
  cord(peak, [0, top + 0.5, 1.25], [0, top - 0.04, 1.52], 0.085); // the stem, down into the sole at the front
  m.oval(strap, [0.13, 0.1, 0.13], [peak[0], peak[1] - 0.02, peak[2]]); // the knot at the top
  return m.build();
}

