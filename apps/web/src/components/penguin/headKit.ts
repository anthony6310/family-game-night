import {
  BufferGeometry, ConeGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry,
} from 'three';
import type { CreatureKind } from '@fgn/shared';

/**
 * The heads of the animals in Penguin Lasso (penguin, seal, polar bear): the shapes and colors in one place, so the very same
 * heads are used on the full animals, poking out of the sack, and in the little pictures of the bag's contents on the screen.
 * Each head is centred on the middle of the skull and faces +z (forward), and wears the same long oval light-yellow eyes as the eskimo.
 * It owns its geometries and materials: call `dispose()` when done.
 */
export class HeadKit {
  private sphere = new SphereGeometry(1, 12, 10); // a unit ball, squashed into ovals
  private penguinSkull = new IcosahedronGeometry(0.4, 1);
  private beak = new ConeGeometry(0.12, 0.34, 6);
  private eye = new SphereGeometry(1, 10, 8);
  private materials = {
    dark: new MeshStandardMaterial({ color: '#1e2a47', flatShading: true, roughness: 0.8 }),
    orange: new MeshStandardMaterial({ color: '#ff9a1f', flatShading: true, roughness: 0.7 }),
    eyeGlow: new MeshBasicMaterial({ color: '#fff2a6' }), // light yellow, unaffected by the lighting so the eyes always show
    sealBody: new MeshStandardMaterial({ color: '#7f93a8', flatShading: true, roughness: 0.8 }),
    sealBelly: new MeshStandardMaterial({ color: '#cbd8e4', flatShading: true, roughness: 0.8 }),
    bearFur: new MeshStandardMaterial({ color: '#eef3f8', flatShading: true, roughness: 1 }),
    bearMuzzle: new MeshStandardMaterial({ color: '#f7eedb', flatShading: true, roughness: 1 }),
    nose: new MeshStandardMaterial({ color: '#0b0d14', roughness: 0.6 }),
    patch: new MeshStandardMaterial({ color: '#2a2f3a', roughness: 1 }), // the dark patch each of the bear's eyes sits on
  };

  /** A fresh head of this kind. */
  build(kind: CreatureKind): Group {
    const head = new Group();
    const oval = (material: MeshStandardMaterial | MeshBasicMaterial, sx: number, sy: number, sz: number, x: number, y: number, z: number, geometry: BufferGeometry = this.sphere) => {
      const mesh = new Mesh(geometry, material);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      head.add(mesh);
      return mesh;
    };
    const eyes = (spread: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      for (const side of [-1, 1]) oval(this.materials.eyeGlow, sx, sy, sz, side * spread, y, z, this.eye);
    };
    if (kind === 'penguin') {
      const skull = new Mesh(this.penguinSkull, this.materials.dark);
      skull.scale.set(1.2, 1.0, 1.1);
      head.add(skull);
      const beak = new Mesh(this.beak, this.materials.orange); // wide and flat from the front, pointed from the side
      beak.rotation.x = Math.PI / 2;
      beak.scale.set(1.5, 0.6, 1.1);
      beak.position.set(0, -0.1, 0.46);
      head.add(beak);
      eyes(0.17, 0.08, 0.39, 0.07, 0.17, 0.05); // lying on the front of the face
    } else if (kind === 'seal') {
      oval(this.materials.sealBody, 0.5, 0.45, 0.55, 0, 0, 0); // a round head
      oval(this.materials.sealBelly, 0.3, 0.24, 0.28, 0, -0.14, 0.42); // the pale muzzle
      oval(this.materials.nose, 0.09, 0.07, 0.07, 0, -0.06, 0.68); // a black nose
      eyes(0.2, 0.12, 0.42, 0.07, 0.15, 0.05);
    } else {
      oval(this.materials.bearFur, 0.65, 0.58, 0.65, 0, 0, 0); // a big head
      oval(this.materials.bearMuzzle, 0.34, 0.27, 0.4, 0, -0.17, 0.58); // the cream muzzle
      oval(this.materials.nose, 0.11, 0.08, 0.08, 0, -0.07, 0.95); // a black nose
      for (const side of [-1, 1]) {
        oval(this.materials.bearFur, 0.2, 0.2, 0.14, side * 0.46, 0.5, -0.08); // round ears
        oval(this.materials.patch, 0.17, 0.14, 0.07, side * 0.27, 0.13, 0.52); // the dark patch each eye sits on
      }
      eyes(0.27, 0.13, 0.57, 0.06, 0.13, 0.04);
    }
    return head;
  }

  dispose() {
    this.sphere.dispose(); this.penguinSkull.dispose(); this.beak.dispose(); this.eye.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
  }
}
