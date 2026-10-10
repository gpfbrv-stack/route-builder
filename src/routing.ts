import { CONFIG, type Profile } from './config';
import { cacheSet, RequestQueue } from './async';
import { distance, validPoint } from './geo';
import type { Point, Segment } from './types';
import { ProfileRegistry } from './brouter-profiles';

export function segmentKey(a: Point, b: Point, profile: Profile) {
  return `${profile}:${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}`;
}
export class Router {
  private cache = new Map<string, Segment>();
  private pending = new Map<string, Promise<Segment>>();
  private queue = new RequestQueue(CONFIG.routing.concurrency);
  constructor(private request: typeof fetch = (...args) => fetch(...args), private registry = new ProfileRegistry(request)) {}
  segment(a: Point, b: Point, profile: Profile): Promise<Segment> {
    if (distance(a, b) < 0.1) return Promise.resolve({ points: [a, b], fallback: false });
    const key = segmentKey(a, b, profile);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const promise = this.queue.run(async () => {
      const requested = CONFIG.profiles[profile];
      const profiles = [{ custom: requested.custom, api: requested.api },
        ...('fallback' in requested ? requested.fallback.slice(0, 1).map(custom => ({ custom, api: 'trekking' })) : [])];
      for (const candidate of profiles) {
        try {
          let api: string;
          let standardProfile = false;
          try { api = await this.registry.id(candidate.custom); }
          catch { api = candidate.api; standardProfile = true; }
          let response = await this.fetchRoute(a, b, api);
          if (response.status === 500 && !standardProfile) {
            this.registry.invalidate(candidate.custom, api);
            try { api = await this.registry.id(candidate.custom); }
            catch { api = candidate.api; standardProfile = true; }
            response = await this.fetchRoute(a, b, api);
          }
          if (!response.ok) throw new Error(`BRouter ${response.status}`);
          const json = await response.json();
          const geometry = json.features?.[0]?.geometry;
          if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) throw new Error('Invalid route');
          const points: Point[] = geometry.coordinates.map((c: number[]) => ({ lng: c[0], lat: c[1] }));
          if (points.length < 2 || !points.every(validPoint)) throw new Error('Invalid coordinates');
          const segment: Segment = { points, fallback: false, profileUsed: standardProfile ? candidate.api : candidate.custom,
            ...(standardProfile ? { standardProfile: true } : {}) };
          cacheSet(this.cache, key, segment, CONFIG.routing.cacheSize);
          return segment;
        } catch { /* Try the configured alternative once before using a straight line. */ }
      }
      return { points: [a, b], fallback: true };
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  private fetchRoute(a: Point, b: Point, profile: string): Promise<Response> {
    const params = new URLSearchParams({ lonlats: `${a.lng},${a.lat}|${b.lng},${b.lat}`, profile, alternativeidx: '0', format: 'geojson' });
    return this.request(`https://brouter.de/brouter?${params}`, { signal: AbortSignal.timeout(CONFIG.routing.timeoutMs) });
  }
  async route(points: Point[], profiles: Profile | Profile[], current = () => true): Promise<Segment[]> {
    if (Array.isArray(profiles) && profiles.length !== Math.max(0, points.length - 1)) throw new Error('区間の走り方の数が不正です');
    const results: Segment[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: CONFIG.routing.concurrency }, async () => {
      while (current() && next < points.length - 1) {
        const i = next++;
        results[i] = await this.segment(points[i], points[i + 1], typeof profiles === 'string' ? profiles : profiles[i]);
      }
    }));
    return results;
  }
}
export function routingWarnings(segments: Segment[], profiles: Profile | Profile[]): string[] {
  const warnings: string[] = [];
  if (segments.some(s => s.fallback)) warnings.push('一部区間を取得できませんでした。該当区間は直線で表示しています。');
  if (segments.some(s => s.standardProfile)) warnings.push('日本向け設定を使えず標準設定で計算しました');
  const alternatives = [...new Set(segments.filter((s, i) => {
    const requested = CONFIG.profiles[typeof profiles === 'string' ? profiles : profiles[i]];
    return !s.fallback && s.profileUsed && s.profileUsed !== requested.custom && s.profileUsed !== requested.api;
  }).map(s => s.profileUsed))];
  if (alternatives.length) warnings.push(`一部区間を代替経路(${alternatives.join(', ')})で計算しました`);
  return warnings;
}
export function joinSegments(segments: Segment[]): Point[] {
  const output: Point[] = [];
  for (const segment of segments) for (const point of segment.points) {
    if (!output.length || distance(output[output.length - 1], point) > 0.01) output.push(point);
  }
  return output;
}
