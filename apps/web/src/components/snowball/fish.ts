import { BoxGeometry, BufferGeometry, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Shape, SphereGeometry, Vector2 } from 'three';

/**
 * A little low-poly fish, built from three.js shapes (no model file), from the sketch: a smooth torpedo body that narrows to a thin tail
 * stalk, a big triangular tail fanning out behind it, a small dorsal fin on the back and a ventral fin underneath (both
 * with a straight edge at the front of the tail side, like the drawing), a V carved out of the snout for the open mouth (a real gap in the
 * body's shape), and an X on each side for the eye. The fish lies along the X axis (nose towards +X) and its flat side faces +Z, so to make one stick to a
 * surface you point its +Z along the surface normal. One kit makes any number of fish that all share the same geometry and materials,
 * so adding fish costs almost nothing.
 */

const HALF_LENGTH = 1.15; // the body's half-length (so the body is 2.3 long, the tail adds about 0.6)
const HALF_HEIGHT = 0.38; // slimmer than before: the body is about 3 times as long as it is tall, like the sketch
const HALF_WIDTH = 0.27;

/** The fish's BODY length (nose to the end of the tail stalk) at scale 1; the tail fin adds about 0.6 more. Other games scale the model by wanted length / this, so its nose is half that length ahead of the middle. */
export const FISH_LENGTH = 2 * HALF_LENGTH;

/** How a kit's fish look. By default: the orange Snowball fish with an X for each eye. */
export interface FishLook {
  body?: string;
  fin?: string;
  /** 'x' = crossed bars (Snowball), 'round' = a white eye with a dark pupil on each side (Fishing). */
  eyes?: 'x' | 'round';
}

export class FishKit {
  constructor(private look: FishLook = {}) {
    this.bodyMaterial = new MeshStandardMaterial({ color: look.body ?? '#ff8a3d', emissive: look.body ?? '#ff5a00', emissiveIntensity: look.body ? 0.08 : 0.18, flatShading: true, roughness: 0.6 });
    this.finMaterial = new MeshStandardMaterial({ color: look.fin ?? '#ff6a2b', emissive: look.fin ?? '#ff4a00', emissiveIntensity: look.fin ? 0.08 : 0.18, flatShading: true, roughness: 0.6, side: 2 });
  }
  private eyeGeometry = new SphereGeometry(1, 12, 10);
  private whiteMaterial = new MeshBasicMaterial({ color: '#ffffff' });
  private bodyGeometry = makeBodyGeometry(HALF_LENGTH, HALF_HEIGHT, HALF_WIDTH);
  // A triangle's corners are given as [x, y] points on the fish's side (x along the fish, y up), then extruded into a thin plate.
  private tailGeometry = flatTriangle([[0, 0], [-0.6, 0.4], [-0.6, -0.4]], 0.07); // widens backwards from the tail stalk
  private dorsalGeometry = flatTriangle([[0, 0], [0.34, 0], [0, 0.32]], 0.06); // a straight edge on the tail side, sloping down towards the head
  private ventralGeometry = flatTriangle([[0, 0], [0.36, 0], [0.3, -0.32]], 0.06); // its point near the head side, like the sketch
  private barGeometry = new BoxGeometry(1, 1, 1); // two of these crossed make an X
  private bodyMaterial: MeshStandardMaterial;
  private finMaterial: MeshStandardMaterial;
  private darkMaterial = new MeshBasicMaterial({ color: '#14213d' });

  /** A new fish, about 2.9 units long, centred on its middle. */
  create(): Group {
    const fish = new Group();
    fish.add(new Mesh(this.bodyGeometry, this.bodyMaterial));

    const tail = new Mesh(this.tailGeometry, this.finMaterial);
    tail.position.x = -HALF_LENGTH + 0.05; // its point sits right at the end of the body's tail stalk
    const dorsal = new Mesh(this.dorsalGeometry, this.finMaterial);
    dorsal.position.set(-0.2, HALF_HEIGHT - 0.04, 0); // on the back, a little behind the middle
    const ventral = new Mesh(this.ventralGeometry, this.finMaterial);
    ventral.position.set(-0.2, -HALF_HEIGHT + 0.04, 0); // underneath, level with the dorsal fin
    fish.add(tail, dorsal, ventral);
    fish.userData.tail = tail; // (a game can wag it)

    for (const side of [1, -1]) {
      if (this.look.eyes === 'round') {
        // Real eyes: a white ball with a dark pupil in front of it, sitting on each side of the head (up near the top front, where the X was).
        const eye = new Mesh(this.eyeGeometry, this.whiteMaterial);
        eye.scale.setScalar(0.13);
        eye.position.set(0.5, 0.16, side * 0.2);
        const pupil = new Mesh(this.eyeGeometry, this.darkMaterial);
        pupil.scale.setScalar(0.07);
        pupil.position.set(0.55, 0.16, side * 0.29);
        fish.add(eye, pupil);
      } else {
        // The eyes: an X (two thin bars crossed) on each side of the head, up near the top front, lying on the body's surface.
        for (const turn of [Math.PI / 4, -Math.PI / 4]) {
          const bar = new Mesh(this.barGeometry, this.darkMaterial);
          bar.scale.set(0.2, 0.045, 0.03);
          bar.position.set(0.5, 0.17, side * 0.215);
          bar.rotation.z = turn;
          fish.add(bar);
        }
      }
    }
    return fish;
  }

  dispose() {
    for (const thing of [this.bodyGeometry, this.tailGeometry, this.dorsalGeometry, this.ventralGeometry, this.barGeometry, this.eyeGeometry, this.whiteMaterial, this.bodyMaterial, this.finMaterial, this.darkMaterial]) thing.dispose();
  }
}

/** A flat plate in the shape of a triangle (corners as [x, y] points), `thickness` thick, centred on the fish's middle plane. */
function flatTriangle(corners: [number, number][], thickness: number): BufferGeometry {
  const shape = new Shape();
  corners.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}

/**
 * The fish's body: a torpedo shape (it narrows to a thin stalk at the tail, is fullest a little past the middle, and tapers to a snout),
 * with its NOSE carved into a V for the open mouth. It is a surface of revolution of that outline, stretched to the given half-length /
 * half-height / half-width. Then every vertex that falls inside the notch (a triangle in side view: wide at the nose tip, narrowing
 * to a point inside the head, and running straight through the head's thickness) is slid back along the fish to the notch's edge. The nose
 * tip collapses back into the head and the surface folds into a V, so the notch is real geometry: you see the body's own surface in it.
 */
function makeBodyGeometry(halfLength: number, halfHeight: number, halfWidth: number): BufferGeometry {
  // The outline as [position along the body from tail (0) to nose (1), thickness (1 = the fullest part)].
  const outline: [number, number][] = [
    [0, 0], [0.01, 0.07], [0.07, 0.2], [0.2, 0.62], [0.38, 0.93], [0.55, 1], [0.7, 0.96], [0.84, 0.82], [0.94, 0.64], [0.985, 0.44], [1, 0.12], [1, 0],
  ];
  const geometry = new LatheGeometry(outline.map(([t, r]) => new Vector2(r, (t * 2 - 1) * halfLength)), 14);
  geometry.rotateZ(-Math.PI / 2); // the outline runs along Y: turn it to run along X, nose towards +X
  geometry.scale(1, halfHeight, halfWidth); // round in cross-section: make it a little taller than it is wide

  const notchDepth = 0.4; // how far the V reaches back from the nose tip
  const notchHalfHeight = 0.15; // how wide it is at the nose tip (each side of the middle line)
  const apex = halfLength - notchDepth; // where the V's point is
  const slope = notchHalfHeight / notchDepth; // how fast the V widens towards the nose
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = Math.abs(position.getY(i));
    if (x > apex && y < slope * (x - apex)) position.setX(i, apex + y / slope); // inside the V: slide back onto its edge
  }
  geometry.computeVertexNormals();
  return geometry;
}
