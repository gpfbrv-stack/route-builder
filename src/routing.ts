import { CONFIG, type Profile } from './config';
import { cacheSet, RequestQueue } from './async';
import { distance, validPoint } from './geo';
import type { Point, Segment } from './types';

export function segmentKey(a: Point, b: Point, profile: Profile) {
  return `${CONFIG.profiles[profile].api}:${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}`;
}
export class Router {
  private cache = new Map<string, Segment>();
  private pending = new Map<string, Promise<Segment>>();
  private queue = new RequestQueue(CONFIG.routing.concurrency);
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}
  segment(a: Point, b: Point, profile: Profile): Promise<Segment> {
    if (distance(a, b) < 0.1) return Promise.resolve({ points: [a, b], fallback: false });
    const key = segmentKey(a, b, profile);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const promise = this.queue.run(async () => {
      const requested = CONFIG.profiles[profile];
      const profiles = [requested.api, ...('fallback' in requested ? requested.fallback.slice(0, 1) : [])];
      for (const profileUsed of profiles) {
        try {
          const params = new URLSearchParams({ lonlats: `${a.lng},${a.lat}|${b.lng},${b.lat}`, profile: profileUsed, alternativeidx: '0', format: 'geojson' });
          const response = await this.request(`https://brouter.de/brouter?${params}`, { signal: AbortSignal.timeout(CONFIG.routing.timeoutMs) });
          if (!response.ok) throw new Error(`BRouter ${response.status}`);
          const json = await response.json();
          const geometry = json.features?.[0]?.geometry;
          if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) throw new Error('Invalid route');
          const points: Point[] = geometry.coordinates.map((c: number[]) => ({ lng: c[0], lat: c[1] }));
          if (points.length < 2 || !points.every(validPoint)) throw new Error('Invalid coordinates');
          const segment: Segment = { points, fallback: false, profileUsed };
          cacheSet(this.cache, key, segment, CONFIG.routing.cacheSize);
          return segment;
        } catch { /* Try the configured alternative once before using a straight line. */ }
      }
      return { points: [a, b], fallback: true };
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  async route(points: Point[], profile: Profile, current = () => true): Promise<Segment[]> {
    const results: Segment[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: CONFIG.routing.concurrency }, async () => {
      while (current() && next < points.length - 1) {
        const i = next++;
        results[i] = await this.segment(points[i], points[i + 1], profile);
      }
    }));
    return results;
  }
}
export function joinSegments(segments: Segment[]): Point[] {
  const output: Point[] = [];
  for (const segment of segments) for (const point of segment.points) {
    if (!output.length || distance(output[output.length - 1], point) > 0.01) output.push(point);
  }
  return output;
}
