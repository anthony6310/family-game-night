import { DirectionalLight, HemisphereLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { CreatureKind } from '@fgn/shared';
import { HeadKit } from './headKit';

/** How much of the picture each head fills: the half-width of the view around it (a smaller number = the head is drawn bigger). The bear's head is the biggest model, so it needs the widest view. */
const VIEW: Record<CreatureKind, { half: number; centreY: number }> = {
  penguin: { half: 0.55, centreY: 0.0 },
  seal: { half: 0.6, centreY: 0.0 },
  bear: { half: 0.82, centreY: 0.1 },
};

let cache: Record<CreatureKind, string> | null = null;

/**
 * A little picture (a PNG as a data URL) of each animal's head, front-on, drawn from the very same 3D head models the game uses (see
 * HeadKit), with a see-through background. Made once and remembered, so the on-screen bag display can show them in ordinary
 * <img> tags.
 */
export function getHeadIcons(): Record<CreatureKind, string> {
  if (cache) return cache;
  const size = 160;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0xb7cde8, 2.4));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 3, 4);
  scene.add(sun);
  const kit = new HeadKit();
  const icons = {} as Record<CreatureKind, string>;
  for (const kind of ['penguin', 'seal', 'bear'] as const) {
    const { half, centreY } = VIEW[kind];
    const camera = new OrthographicCamera(-half, half, half + centreY, -half + centreY, 0.1, 10);
    camera.position.set(0, 0, 4); // in front of the face, looking back at it
    const head = kit.build(kind);
    scene.add(head);
    renderer.render(scene, camera);
    icons[kind] = canvas.toDataURL('image/png');
    scene.remove(head);
  }
  kit.dispose();
  renderer.dispose();
  cache = icons;
  return icons;
}
