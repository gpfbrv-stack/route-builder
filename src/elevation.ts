import { cumulativeDistances } from './geo';
import type { Point } from './types';
export interface Sample extends Point { distance: number; ele: number | null }
export function decodeDEM(r: number, g: number, b: number, alpha = 255): number | null {
  const x = r * 65536 + g * 256 + b;
  return alpha === 0 || x === 8388608 ? null : (x < 8388608 ? x : x - 16777216) * 0.01;
}
export function tilePixel(point: Point, zoom = 14) {
  const lat = Math.max(-85.05112878, Math.min(85.05112878, point.lat)) * Math.PI / 180;
  const size = 2 ** zoom * 256;
  const x = ((point.lng + 180) / 360 * size % size + size) % size;
  const y = Math.max(0, Math.min(size - 1, (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * size));
  return { x: Math.floor(x / 256), y: Math.floor(y / 256), px: Math.floor(x % 256), py: Math.floor(y % 256) };
}
export function sampleRoute(points: Point[], interval = 20): Sample[] {
  if (!points.length) return [];
  if (!(interval > 0)) throw new Error('Sampling interval must be positive');
  const ds = cumulativeDistances(points); const total = ds.at(-1)!;
  const result: Sample[] = []; let i = 1;
  const add = (d: number) => {
    while (i < points.length - 1 && ds[i] < d) i++;
    const a = points[Math.max(0, i - 1)] ?? points[0]; const b = points[i] ?? a;
    const span = (ds[i] ?? 0) - (ds[i - 1] ?? 0);
    const t = span ? (d - ds[i - 1]) / span : 0;
    result.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, distance: d, ele: typeof a.ele === 'number' && typeof b.ele === 'number' ? a.ele + (b.ele - a.ele) * t : null });
  };
  for (let d = 0; d < total; d += interval) add(d);
  add(total); return result;
}
// Direction changes are accepted only after a threshold-sized reversal.
// Missing values break the run; the final accepted trend includes its full extreme.
export function elevationStats(values: (number | null)[], threshold = 5) {
  if (threshold < 0 || !Number.isFinite(threshold)) throw new Error('Invalid hysteresis');
  let ascent = 0, descent = 0, highest: number | null = null;
  let anchor: number | null = null, extreme = 0, direction = 0;
  const finish = () => {
    if (anchor !== null && direction === 1) ascent += extreme - anchor;
    if (anchor !== null && direction === -1) descent += anchor - extreme;
  };
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) { finish(); anchor = null; direction = 0; continue; }
    highest = highest === null ? value : Math.max(highest, value);
    if (anchor === null) { anchor = extreme = value; continue; }
    if (!direction) {
      if (Math.abs(value - anchor) >= threshold && value !== anchor) { direction = Math.sign(value - anchor); extreme = value; }
    } else if (direction === 1) {
      if (value > extreme) extreme = value;
      else if (extreme - value >= threshold && value !== extreme) { ascent += extreme - anchor; anchor = extreme; extreme = value; direction = -1; }
    } else {
      if (value < extreme) extreme = value;
      else if (value - extreme >= threshold && value !== extreme) { descent += anchor - extreme; anchor = extreme; extreme = value; direction = 1; }
    }
  }
  finish(); return { ascent, descent, highest };
}
