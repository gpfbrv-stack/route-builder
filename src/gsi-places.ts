import { CONFIG } from './config';
import { cacheSet, RequestQueue } from './async';
import { tilePixel, sampleRoute } from './elevation';
import { cumulativeDistances, nearestOnRoute, validPoint } from './geo';
import type { Place, Point } from './types';

export interface Annotation { geometry?: { type: string; coordinates: number[] }; properties?: { ftCode?: string | number; knj?: string } }
type Tile = { x: number; y: number };
export function annotationTiles(route: Point[]): Tile[] {
  if (!route.length || route.some(p => !validPoint(p))) return [];
  const { zoom, marginDegrees: m, tileLimit } = CONFIG.gsiPlaces;
  let south = 85, north = -85, west = 180, east = -180;
  for (const p of route) { south = Math.min(south, p.lat); north = Math.max(north, p.lat); west = Math.min(west, p.lng); east = Math.max(east, p.lng); }
  const a = tilePixel({ lat: north + m, lng: Math.max(-180, west - m) }, zoom);
  const b = tilePixel({ lat: south - m, lng: Math.min(179.999999, east + m) }, zoom);
  if ((b.x - a.x + 1) * (b.y - a.y + 1) <= tileLimit) {
    const tiles: Tile[] = [];
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) tiles.push({ x, y });
    return tiles;
  }
  // Sample segments too: sparse imported tracks must not lose intervening tiles.
  const along = new Map<string, Tile>();
  const points = sampleRoute(route, 250);
  for (const p of points) {
    const tile = tilePixel(p, zoom); along.set(`${tile.x}/${tile.y}`, tile);
  }
  const core = [...along.values()];
  const spread = (tiles: Tile[], limit: number) => limit === 1 ? [tiles[0]] :
    Array.from({ length: limit }, (_, i) => tiles[Math.floor(i * (tiles.length - 1) / (limit - 1))]);
  if (core.length > tileLimit) return spread(core, tileLimit);
  const coreKeys = new Set(along.keys());
  // Include nearby annotations across tile edges after prioritizing the route itself.
  for (const p of points) for (const dx of [-m, 0, m]) for (const dy of [-m, 0, m]) {
    const tile = tilePixel({ lat: p.lat + dy, lng: p.lng + dx }, zoom); along.set(`${tile.x}/${tile.y}`, tile);
  }
  const tiles = [...along.values()];
  if (tiles.length <= tileLimit) return tiles;
  const remaining = tileLimit - core.length;
  return remaining ? [...core, ...spread([...along.entries()].filter(([key]) => !coreKeys.has(key)).map(([, tile]) => tile), remaining)] : core;
}
function pointAt(route: Point[], metres: number): Point {
  const ds = cumulativeDistances(route);
  const i = Math.max(1, ds.findIndex(d => d >= metres));
  const a = route[i - 1], b = route[i] ?? a;
  const t = ds[i] > ds[i - 1] ? (metres - ds[i - 1]) / (ds[i] - ds[i - 1]) : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}
export function filterAnnotations(features: Annotation[], route: Point[]): Place[] {
  const places = new Map<string, Place>();
  for (const f of features) {
    const name = f.properties?.knj, code = String(f.properties?.ftCode).padStart(4, '0');
    const kind = code === '0332' && name && /(峠|乗越|越)$/.test(name) ? 'pass' : code === '0312' ? 'peak' : null;
    if (!kind || !name || f.geometry?.type !== 'Point') continue;
    const [lng, lat] = f.geometry.coordinates, point = { lat, lng };
    if (!validPoint(point)) continue;
    const nearest = nearestOnRoute(point, route);
    if (nearest.offset > (kind === 'pass' ? 250 : 200)) continue;
    const key = `${name}/${lat}/${lng}`;
    places.set(key, { ...(kind === 'pass' ? pointAt(route, nearest.routeDistance) : point), ...nearest, id: -places.size - 1, name, kind, ele: null, elevationSource: 'DEM' });
  }
  return [...places.values()].sort((a, b) => a.routeDistance - b.routeDistance).map((p, i) => ({ ...p, id: -i - 1 }));
}
export function peakSamples(point: Point): Point[] {
  const result = [{ lat: point.lat, lng: point.lng }];
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, degrees = 150 / 6371008.8 * 180 / Math.PI;
    result.push({ lat: point.lat + Math.cos(angle) * degrees, lng: point.lng + Math.sin(angle) * degrees / Math.cos(point.lat * Math.PI / 180) });
  }
  return result;
}
export class GsiPlaceProvider {
  private cache = new Map<string, Annotation[]>();
  private queue = new RequestQueue(CONFIG.gsiPlaces.concurrency);
  constructor(private elevation: (p: Point) => Promise<number | null>, private request: typeof fetch = (...args) => fetch(...args)) {}
  private async tile({ x, y }: Tile, current: () => boolean): Promise<Annotation[]> {
    const key = `${x}/${y}`;
    return this.queue.run(async () => {
      if (!current()) return [];
      const hit = this.cache.get(key);
      if (hit) { cacheSet(this.cache, key, hit, CONFIG.gsiPlaces.cacheSize); return hit; }
      const response = await this.request(`https://cyberjapandata.gsi.go.jp/xyz/experimental_anno/15/${key}.geojson`, { signal: AbortSignal.timeout(CONFIG.gsiPlaces.timeoutMs) });
      if (!response.ok && response.status !== 404) throw new Error(`地理院注記 ${response.status}`);
      const data = response.status === 404 ? { features: [] } : await response.json();
      if (!Array.isArray(data.features)) throw new Error('地理院注記の応答が不正です');
      cacheSet(this.cache, key, data.features, CONFIG.gsiPlaces.cacheSize);
      return data.features;
    });
  }
  async get(route: Point[], current = () => true): Promise<Place[]> {
    const tiles = await Promise.allSettled(annotationTiles(route).map(tile => this.tile(tile, current)));
    if (!current()) return [];
    if (tiles.length && tiles.every(t => t.status === 'rejected')) throw new Error('地理院注記を取得できませんでした');
    const places = filterAnnotations(tiles.flatMap(t => t.status === 'fulfilled' ? t.value : []), route);
    for (const p of places) {
      if (!current()) return [];
      const values = await Promise.all((p.kind === 'peak' ? peakSamples(p) : [p]).map(q => this.elevation(q)));
      const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
      p.ele = valid.length ? Math.max(...valid) : null;
    }
    return places;
  }
}
