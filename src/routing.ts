import { CONFIG, type Profile } from './config';
import { cacheSet, RequestQueue } from './async';
import { distance, routeLength, validPoint } from './geo';
import type { LegMode, LegPrefer, Point, Segment } from './types';
import { ProfileRegistry } from './brouter-profiles';
import { GsiRouter } from './gsi-router';
import { applySurfaceMessages, unknownSurface } from './surface';

/** Read the first/last data row, never a nearby road when endpoint tags are missing. */
export function endpointHighways(messages: unknown): Pick<Segment, 'startHighway' | 'endHighway'> {
  if (!Array.isArray(messages) || messages.length < 2 || !Array.isArray(messages[0])) return {};
  const column = messages[0].indexOf('WayTags');
  if (column < 0) return {};
  const highway = (row: unknown) => {
    const tags = Array.isArray(row) ? row[column] : undefined;
    return typeof tags === 'string' ? /(?:^|\s)highway=([^\s]+)/.exec(tags)?.[1] : undefined;
  };
  return { startHighway: highway(messages[1]), endHighway: highway(messages.at(-1)) };
}

export function segmentKey(a: Point, b: Point, profile: Profile, mode: LegMode = 'road', prefer: LegPrefer = 'main') {
  return `${mode === 'straight' ? '-' : profile}:${mode}:${prefer}:${a.lng.toFixed(6)},${a.lat.toFixed(6)}|${b.lng.toFixed(6)},${b.lat.toFixed(6)}`;
}
export class Router {
  private detourQueue = new RequestQueue(1);
  private cache = new Map<string, Segment>();
  private pending = new Map<string, { promise: Promise<Segment>; consumers: (() => boolean)[] }>();
  private queue = new RequestQueue(CONFIG.routing.concurrency);
  constructor(private request: typeof fetch = (...args) => fetch(...args), private registry = new ProfileRegistry(request), private gsi = new GsiRouter(request)) {}
  async detour(a: Point, b: Point, profile: Profile, mode: LegMode, segment: Segment, current = () => true): Promise<Detour | undefined> {
    const osmM = routeLength(segment.points);
    if (mode !== 'road' || segment.fallback || segment.gsi || !segment.profileUsed || !isDetour(osmM, distance(a, b))) return;
    return this.detourQueue.run(async () => {
      if (!current()) return;
      try {
        const alternative = await this.segment(a, b, profile, 'gsi', current);
        const gsiM = routeLength(alternative.points);
        if (current() && alternative.gsi && !alternative.fallback && gsiM < 0.6 * osmM) {
          return { osmM, gsiM, key: JSON.stringify([segmentKey(a, b, profile), segment.points, alternative.points]) };
        }
      } catch { /* Background comparison must never interrupt routing. */ }
    });
  }
  cached(a: Point, b: Point, profile: Profile, mode: LegMode = 'road', prefer: LegPrefer = 'main'): Segment | undefined {
    return this.cache.get(segmentKey(a, b, profile, mode, prefer));
  }
  segment(a: Point, b: Point, profile: Profile, mode: LegMode = 'road', current = () => true, prefer: LegPrefer = 'main'): Promise<Segment> {
    if (mode === 'straight' || distance(a, b) < 0.1) return Promise.resolve({ points: unknownSurface([a, b]), fallback: false });
    const key = segmentKey(a, b, profile, mode, prefer);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) { pending.consumers.push(current); return pending.promise; }
    const consumers = [current], active = () => consumers.some(current => current());
    const gsiSegment = async (rescue: boolean): Promise<Segment> => {
      try {
        const segment: Segment = { ...await this.gsi.route(a, b, active), gsi: true, ...(rescue ? { gsiRescue: true } : {}) };
        segment.points = unknownSurface(segment.points);
        cacheSet(this.cache, key, segment, CONFIG.routing.cacheSize);
        return segment;
      } catch (error) {
        if (!active()) throw error;
        return { points: unknownSurface([a, b]), fallback: true, ...(!rescue ? { error: error instanceof Error ? error.message : '地理院の道を取得できませんでした' } : {}) };
      }
    };
    const promise = this.queue.run(async () => {
      if (!active()) throw new DOMException('経路計算を中止しました', 'AbortError');
      const failedGsi = mode === 'gsi' ? await gsiSegment(false) : undefined;
      if (failedGsi && !failedGsi.fallback) return failedGsi;
      const requested = CONFIG.profiles[profile];
      const profiles = [{ custom: mode === 'road' && prefer === 'side' && 'customSide' in requested ? requested.customSide : requested.custom, api: requested.api },
        ...('fallback' in requested ? requested.fallback.slice(0, 1).map(custom => ({ custom, api: 'trekking' })) : [])];
      for (const candidate of profiles) {
        if (!active()) throw new DOMException('経路計算を中止しました', 'AbortError');
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
          const segment: Segment = { points: mode === 'gsi' ? points : applySurfaceMessages(points, json.features[0].properties?.messages), fallback: false, profileUsed: standardProfile ? candidate.api : candidate.custom,
            ...(mode === 'road' ? endpointHighways(json.features[0].properties?.messages) : {}),
            ...(failedGsi ? { brouterRescue: true } : {}),
            ...(standardProfile ? { standardProfile: true } : {}) };
          cacheSet(this.cache, key, segment, CONFIG.routing.cacheSize);
          return segment;
        } catch { /* Try the configured alternative, then GSI, before a straight line. */ }
      }
      return failedGsi ?? gsiSegment(true);
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, { promise, consumers });
    return promise;
  }
  private fetchRoute(a: Point, b: Point, profile: string): Promise<Response> {
    const params = new URLSearchParams({ lonlats: `${a.lng},${a.lat}|${b.lng},${b.lat}`, profile, alternativeidx: '0', format: 'geojson' });
    return this.request(`https://brouter.de/brouter?${params}`, { signal: AbortSignal.timeout(CONFIG.routing.timeoutMs) });
  }
  async route(points: Point[], profiles: Profile | Profile[], current = () => true, resolved?: (index: number, segment: Segment) => void, modes: LegMode[] = points.slice(1).map(() => 'road'), prefers: LegPrefer[] = points.slice(1).map(() => 'main')): Promise<Segment[]> {
    if (Array.isArray(profiles) && profiles.length !== Math.max(0, points.length - 1)) throw new Error('区間の走り方の数が不正です');
    if (modes.length !== Math.max(0, points.length - 1)) throw new Error('区間の線の引き方が不正です');
    if (prefers.length !== Math.max(0, points.length - 1)) throw new Error('区間の優先設定の数が不正です');
    const results: Segment[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: CONFIG.routing.concurrency }, async () => {
      while (current() && next < points.length - 1) {
        const i = next++;
        try {
          results[i] = await this.segment(points[i], points[i + 1], typeof profiles === 'string' ? profiles : profiles[i], modes[i], current, prefers[i]);
        } catch (error) { if (!current()) return; throw error; }
        if (current()) resolved?.(i, results[i]);
      }
    }));
    return results;
  }
}
export interface Detour { key: string; osmM: number; gsiM: number }
export function isDetour(lengthM: number, directM: number): boolean {
  return lengthM > Math.max(CONFIG.gsi.detourRatio * directM, directM + CONFIG.gsi.detourExtraM);
}
export function routingWarnings(segments: Segment[], profiles: Profile | Profile[], prefers: LegPrefer[] = [], modes: LegMode[] = []): string[] {
  const warnings: string[] = [];
  if (segments.some(s => s.fallback)) warnings.push('一部区間を取得できませんでした。該当区間は直線で表示しています。');
  warnings.push(...new Set(segments.flatMap(s => s.error ? [s.error] : [])));
  if (segments.some(s => s.gsiRescue)) warnings.push('OSMで経路が見つからないため地理院の道で計算しました');
  warnings.push(...new Set(segments.filter(s => s.brouterRescue).map(s => `地理院の道で引けないため ${s.profileUsed} で計算しました`)));
  if (segments.some(s => s.standardProfile)) warnings.push('日本向け設定を使えず標準設定で計算しました');
  const alternatives = [...new Set(segments.filter((s, i) => {
    const requested = CONFIG.profiles[typeof profiles === 'string' ? profiles : profiles[i]];
    return !s.fallback && s.profileUsed && s.profileUsed !== (prefers[i] === 'side' && (modes[i] ?? 'road') === 'road' && 'customSide' in requested ? requested.customSide : requested.custom) && s.profileUsed !== requested.api;
  }).map(s => s.profileUsed))];
  if (alternatives.length) warnings.push(`一部区間を代替経路(${alternatives.join(', ')})で計算しました`);
  return warnings;
}
export function joinSegments(segments: Segment[]): Point[] {
  const output: Point[] = [];
  for (const segment of segments) for (const [i, point] of segment.points.entries()) {
    if (!output.length || distance(output[output.length - 1], point) > 0.01) {
      // Any gap between independently snapped legs has no observed surface.
      output.push(i === 0 ? unknownSurface([point])[0] : point);
    }
  }
  return output;
}
