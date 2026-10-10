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
export function nearestOnRoute(point: Point, route: Point[]) {
  let offset = Infinity, routeDistance = 0, walked = 0;
  if (route.length === 1) return { offset: distance(point, route[0]), routeDistance: 0 };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const k = Math.cos(rad((a.lat + b.lat + point.lat) / 3));
    const ax = rad(a.lng - point.lng) * R * k, ay = rad(a.lat - point.lat) * R;
    const bx = rad(b.lng - point.lng) * R * k, by = rad(b.lat - point.lat) * R;
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy), segment = distance(a, b);
    if (d < offset) { offset = d; routeDistance = walked + t * segment; }
    walked += segment;
  }
  return { offset, routeDistance };
}
