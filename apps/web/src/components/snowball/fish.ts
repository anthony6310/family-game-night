import { BoxGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';

/**
 * A little low-poly fish, built from three.js shapes (no model file): an orange, slightly elongated ellipsoid body, a
 * flat cone tail, a triangular top fin, a small triangular notch carved out of the nose for the mouth (a real gap in the body's shape), and an X on each side where the eye
 * would be. The fish lies along the X axis (nose towards +X) and its flat side faces +Z, so to make one stick to
 * a surface you point its +Z along the surface normal. One kit makes any number of fish that all share the same
 * geometry and materials, so adding fish costs almost nothing.
 */
export class FishKit {
  private bodyGeometry = makeBodyGeometry(1.15, 0.42, 0.26);
  private tailGeometry = new ConeGeometry(0.5, 0.9, 4);
  private barGeometry = new BoxGeometry(1, 1, 1); // two of these crossed make an X
  private finGeometry = new ConeGeometry(1, 1, 3); // a three-sided cone, squashed flat, is a triangular fin
  private bodyMaterial = new MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff5a00', emissiveIntensity: 0.18, flatShading: true, roughness: 0.6 });
  private tailMaterial = new MeshStandardMaterial({ color: '#ff6a2b', emissive: '#ff4a00', emissiveIntensity: 0.18, flatShading: true, roughness: 0.6 });
  private darkMaterial = new MeshBasicMaterial({ color: '#14213d' });

  /** A new fish, about 2.6 units long, centred on its middle. */
  create(): Group {
    const fish = new Group();
    const middle = 0.5; // shifts everything so the group's origin is the fish's centre rather than its body's
    const bodyLength = 1.15; // the body's half-length: 0.9 was the round goldfish, so this is a little longer (the barracuda was 1.5)

    const body = new Mesh(this.bodyGeometry, this.bodyMaterial); // (already the right size: see makeBodyGeometry)
    body.position.x = middle;

    const tail = new Mesh(this.tailGeometry, this.tailMaterial);
    tail.rotation.z = -Math.PI / 2; // a cone points along +Y; turn it so its point meets the body and its wide end trails behind
    tail.scale.set(1, 1, 0.3); // flat like a fin
    tail.position.x = middle - bodyLength - 0.35;

    // The top (dorsal) fin: a flat triangle standing on the back, swept a little towards the tail.
    const fin = new Mesh(this.finGeometry, this.tailMaterial);
    fin.scale.set(0.3, 0.55, 0.05);
    fin.rotation.z = 0.4; // a cone points up (+Y); leaning it by this much sweeps the point back (towards -X)
    fin.position.set(middle - 0.1, 0.62, 0);

    fish.add(body, tail, fin);

    // The eyes: an X (two thin bars crossed) on each side of the head, lying on the body's surface.
    for (const side of [1, -1]) {
      for (const turn of [Math.PI / 4, -Math.PI / 4]) {
        const bar = new Mesh(this.barGeometry, this.darkMaterial);
        bar.scale.set(0.2, 0.045, 0.03);
        bar.position.set(middle + 0.62, 0.1, side * 0.215);
        bar.rotation.z = turn;
        fish.add(bar);
      }
    }
    return fish;
  }

  dispose() {
    for (const thing of [this.bodyGeometry, this.tailGeometry, this.barGeometry, this.finGeometry, this.bodyMaterial, this.tailMaterial, this.darkMaterial]) thing.dispose();
  }
}

/**
 * The fish's body: an ellipsoid with the given half-length / half-height / half-width, with its NOSE carved into a V.
 * It starts as a low-poly sphere turned so its pole is at the nose, stretched to size. Then every vertex that falls
 * inside the notch (a triangle in side view: wide at the nose tip, narrowing to a point inside the head, and running
 * straight through the head's thickness) is slid back along the fish to the notch's edge. The nose tip collapses back
 * into the head and the surface folds into a V, so the notch is real geometry: you see the body's own surface in it.
 */
function makeBodyGeometry(halfLength: number, halfHeight: number, halfWidth: number): SphereGeometry {
  const geometry = new SphereGeometry(1, 10, 14); // 10 segments around, 14 rings along: enough rings near the nose to carve a clean V
  geometry.rotateZ(-Math.PI / 2); // the sphere's poles are on its Y axis: turn them to point along X, so one pole is the nose
  geometry.scale(halfLength, halfHeight, halfWidth);

  const notchDepth = 0.38; // how far the V reaches back from the nose tip
  const notchHalfHeight = 0.13; // how wide it is at the nose tip (each side of the middle line)
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
