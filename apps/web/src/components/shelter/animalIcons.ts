import { DirectionalLight, HemisphereLight, Mesh, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { AnimalKit } from './AnimalKit';

/**
 * A little picture (a PNG as a data URL) of every kind (every type in each of its colors), drawn from the very same 3D models the game uses, from a three-quarter view with a
 * see-through background. Used by the on-screen request strip, so players can check what each adopter wants without walking back to the desk.
 */
export function makeSpeciesIcons(kit: AnimalKit): string[] {
  const size = 144;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0xc9d3de, 2.6));
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 5, 6);
  scene.add(sun);
  const icons: string[] = [];
  for (const model of kit.models) {
    const half = Math.max(model.height, model.length, model.width) * 0.62;
    const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 100);
    const mesh = new Mesh(model.geometry, kit.material);
    mesh.rotation.y = 0.75; // a three-quarter view
    scene.add(mesh);
    camera.position.set(0, model.height * 0.5 + half * 0.5, 20);
    camera.lookAt(0, model.height * 0.45, 0);
    renderer.render(scene, camera);
    icons.push(canvas.toDataURL('image/png'));
    scene.remove(mesh);
  }
  renderer.dispose();
  return icons;
}
