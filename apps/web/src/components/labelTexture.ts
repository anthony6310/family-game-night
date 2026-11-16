import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial, type Texture } from 'three';

/** A player's name as a picture (for a floating name tag): bold text in their colour with a dark outline, so it reads on any background. Shared by the 3D games. */
export function makeLabelTexture(name: string, color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(20,30,60,0.85)';
  g.strokeText(name, 256, 64, 480);
  g.fillStyle = color;
  g.fillText(name, 256, 64, 480);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Name tags live on their own TOP LAYER: they are drawn after (on top of) everything else in the scene and ignore depth, so no 3D
 * object, a big sack, a hill, a wall or another character, can ever cut into them or hide part of a name. Every 3D game makes its
 * floating names with this, so they behave the same everywhere (see GAME_RULES.md). Position it and set its scale; it always faces the camera.
 * (The price of ignoring depth: a name can show through something that is in front of its owner, like a hill.)
 */
export const NAME_TAG_RENDER_ORDER = 100; // higher than any other effect in the games, so names are drawn last

export function createNameTag(name: string, color: string): Sprite {
  const material = new SpriteMaterial({ map: makeLabelTexture(name, color), transparent: true, depthTest: false, depthWrite: false });
  const tag = new Sprite(material);
  tag.renderOrder = NAME_TAG_RENDER_ORDER;
  return tag;
}

/** Frees a name tag's GPU memory (its picture and material). Call it when the scene is torn down. */
export function disposeNameTag(tag: Sprite) {
  tag.material.map?.dispose();
  tag.material.dispose();
}
