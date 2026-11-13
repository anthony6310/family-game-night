import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

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
