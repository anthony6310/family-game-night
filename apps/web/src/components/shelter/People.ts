import type { BufferGeometry } from 'three';
import { Model } from './AnimalKit';

/** How tall a person is (about 1.7 m at 2.2 units per metre, like the animals). The eyes are a little below the top. */
export const PERSON_HEIGHT = 3.7;

export interface PersonLook {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'cap' | 'bald';
  apron?: string; // a volunteer's vest over the shirt
}

const SKIN = ['#f1c9a5', '#e0a97c', '#c68642', '#8d5524', '#ffdbac', '#a9714b'];
const HAIR = ['#2b2118', '#5b3a1e', '#c8942c', '#8a2f1d', '#d9d9d9', '#111111'];
const SHIRTS = ['#e45858', '#4f86e0', '#46b06a', '#e0a63c', '#9a6ad8', '#e07fb4', '#3fb5b5', '#f08a4b'];
const PANTS = ['#3b4a6b', '#4a4a4a', '#6b5a3b', '#2f5a4a', '#5a3b3b'];

/** A person for the adoption line, picked from the adoptee's id (the same id always looks the same). */
export function adopteeLook(id: number): PersonLook {
  const pick = <T,>(list: readonly T[], k: number) => list[Math.abs(Math.floor(id * 7919 + k * 104729)) % list.length];
  return { shirt: pick(SHIRTS, 1), pants: pick(PANTS, 2), skin: pick(SKIN, 3), hair: pick(HAIR, 4), hairStyle: pick(['short', 'long', 'cap', 'bald', 'short'] as const, 5) };
}

/** A low-poly person facing +z, feet on y = 0, as one merged vertex-colored geometry. */
export function buildPerson(look: PersonLook): BufferGeometry {
  const m = new Model();
  const shoe = '#2a2420';
  for (const s of [-1, 1]) {
    m.cyl(look.pants, 0.24, 1.7, [s * 0.27, 1.0, 0], [0, 0, 0], 0.9); // legs
    m.oval(shoe, [0.27, 0.16, 0.45], [s * 0.27, 0.14, 0.12]); // shoes
    m.cyl(look.skin, 0.13, 0.9, [s * 0.78, 2.25, 0.05], [0, 0, s * 0.08]); // arms hanging
    m.cyl(look.shirt, 0.17, 0.5, [s * 0.76, 2.75, 0.02], [0, 0, s * 0.08]); // sleeves
    m.oval(look.skin, [0.15, 0.17, 0.15], [s * 0.8, 1.7, 0.06]); // hands
    m.oval(look.skin, [0.06, 0.07, 0.04], [s * 0.15, 3.38, 0.34]); // (ears are not drawn: cheeks instead)
  }
  m.oval(look.pants, [0.58, 0.26, 0.36], [0, 1.85, 0]); // hips
  m.oval(look.shirt, [0.6, 0.8, 0.38], [0, 2.55, 0]); // the body
  if (look.apron) m.oval(look.apron, [0.5, 0.62, 0.34], [0, 2.5, 0.12]);
  m.oval(look.skin, [0.16, 0.18, 0.16], [0, 3.1, 0.04]); // the neck
  m.oval(look.skin, [0.4, 0.42, 0.4], [0, 3.35, 0.05]); // the head
  m.oval('#fafafa', [0.09, 0.1, 0.05], [-0.15, 3.42, 0.42]).oval('#fafafa', [0.09, 0.1, 0.05], [0.15, 3.42, 0.42]);
  m.oval('#14161c', [0.05, 0.06, 0.04], [-0.15, 3.42, 0.46]).oval('#14161c', [0.05, 0.06, 0.04], [0.15, 3.42, 0.46]);
  m.oval('#b5524a', [0.13, 0.04, 0.04], [0, 3.2, 0.44]); // a smile
  if (look.hairStyle === 'short') m.oval(look.hair, [0.43, 0.3, 0.43], [0, 3.52, -0.02]);
  else if (look.hairStyle === 'long') { m.oval(look.hair, [0.45, 0.32, 0.45], [0, 3.52, -0.03]); m.oval(look.hair, [0.42, 0.55, 0.22], [0, 3.1, -0.28]); }
  else if (look.hairStyle === 'cap') { m.oval(look.shirt, [0.44, 0.28, 0.44], [0, 3.56, 0]); m.oval(look.shirt, [0.3, 0.05, 0.3], [0, 3.46, 0.48]); }
  return m.build();
}

/** The look of a volunteer (a player): their own color for the shirt, with a vest. */
export function volunteerLook(color: string, id: string): PersonLook {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  const k = Math.abs(h);
  return { shirt: color, pants: PANTS[k % PANTS.length], skin: SKIN[(k >> 3) % SKIN.length], hair: HAIR[(k >> 6) % HAIR.length], hairStyle: (['short', 'long', 'cap', 'short'] as const)[(k >> 9) % 4], apron: '#f4f1e8' };
}
