import { CONFIG } from './config';
import { cacheSet, RequestQueue } from './async';
import { decodeDEM, tilePixel, type Sample } from './elevation';
import type { Point } from './types';
type Pixels = Uint8ClampedArray | null;
export class DemProvider {
  private cache = new Map<string, Promise<Pixels>>();
  private queue = new RequestQueue(4);
  constructor(private load: (url: string) => Promise<Pixels> = loadPixels) {}
  private tile(id: string, x: number, y: number) {
    const key = `${id}/${CONFIG.elevation.zoom}/${x}/${y}`;
    let result = this.cache.get(key);
    if (!result) {
      result = this.queue.run(() => this.load(`https://cyberjapandata.gsi.go.jp/xyz/${key}.png`)).catch(() => null);
      cacheSet(this.cache, key, result, 128);
    }
    return result;
  }
  async elevation(point: Point): Promise<number | null> {
    const { x, y, px, py } = tilePixel(point, CONFIG.elevation.zoom);
    for (const id of CONFIG.elevation.tileIds) {
      const data = await this.tile(id, x, y);
      if (!data) continue;
      const n = (py * 256 + px) * 4;
      const value = decodeDEM(data[n], data[n + 1], data[n + 2], data[n + 3]);
      if (value !== null && Number.isFinite(value)) return value;
    }
    return null;
  }
  async sample(points: Sample[], current = () => true): Promise<Sample[]> {
    const result: Sample[] = []; let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (current() && next < points.length) {
        const i = next++; const point = points[i];
        result[i] = { ...point, ele: await this.elevation(point) };
      }
    }));
    return result;
  }
}
function loadPixels(url: string): Promise<Pixels> {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    let done = false;
    const finish = (pixels: Pixels) => { if (done) return; done = true; clearTimeout(timer); img.onload = null; img.onerror = null; resolve(pixels); };
    const timer = setTimeout(() => { finish(null); img.src = ''; }, 15000);
    img.onerror = () => finish(null);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(img, 0, 0); finish(context.getImageData(0, 0, 256, 256).data);
      } catch { finish(null); }
    };
    img.src = url;
  });
}
