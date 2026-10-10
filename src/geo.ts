import type { Point } from './types';
const R = 6371008.8;
const rad = (d: number) => d * Math.PI / 180;
export function validPoint(p: Point): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 85.05112878 && Math.abs(p.lng) <= 180;
}
export function distance(a: Point, b: Point): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function cumulativeDistances(points: Point[]): number[] {
  let total = 0;
  return points.map((p, i) => { if (i) total += distance(points[i - 1], p); return total; });
}
export function routeLength(points: Point[]): number { return cumulativeDistances(points).at(-1) ?? 0; }
