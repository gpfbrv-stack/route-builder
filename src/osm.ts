import { CONFIG } from './config';
import { cacheSet, RequestQueue } from './async';
import { nearestOnRoute, validPoint } from './geo';
import type { Point } from './types';

export interface OsmNode { id: number; lat: number; lon: number; tags?: Record<string, string> }
export interface OsmElement {
  type: 'node' | 'way' | 'relation'; id: number;
  lat?: number; lon?: number; center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
export type PoiKind = keyof typeof CONFIG.poi.radii;
export interface OsmPoi extends OsmNode { type: OsmElement['type']; kind: PoiKind; offset: number; routeDistance: number }
export interface OsmResult { places: OsmNode[]; pois: OsmPoi[] }

export function routeBBox(route: Point[]) {
  if (!route.length) throw new Error('Empty route');
  let south = 90, west = 180, north = -90, east = -180;
  for (const p of route) { south = Math.min(south, p.lat); north = Math.max(north, p.lat); west = Math.min(west, p.lng); east = Math.max(east, p.lng); }
  const m = CONFIG.places.marginDegrees;
  return [Math.max(-85, Math.floor((south - m) * 100) / 100), Math.max(-180, Math.floor((west - m) * 100) / 100), Math.min(85, Math.ceil((north + m) * 100) / 100), Math.min(180, Math.ceil((east + m) * 100) / 100)];
}

// Iterative Douglas-Peucker avoids stack overflow on long imported tracks.
export function simplifyRoute(route: Point[], toleranceM = 30, maxPoints = 400): Point[] {
  if (toleranceM <= 0 || !Number.isFinite(toleranceM) || !Number.isInteger(maxPoints) || maxPoints < 2) throw new Error('Invalid simplification limits');
  if (route.some(p => !validPoint(p))) throw new Error('Invalid route point');
  if (route.length <= 2) return route.slice();
  for (;;) {
    const keep = new Set([0, route.length - 1]);
    const stack: [number, number][] = [[0, route.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop()!;
      let farthest = -1, max = toleranceM;
      for (let i = first + 1; i < last; i++) {
        const d = nearestOnRoute(route[i], [route[first], route[last]]).offset;
        if (d > max) { max = d; farthest = i; }
      }
      if (farthest !== -1) { keep.add(farthest); stack.push([first, farthest], [farthest, last]); }
    }
    if (keep.size <= maxPoints) return [...keep].sort((a, b) => a - b).map(i => route[i]);
    toleranceM *= 2;
  }
}

export function buildOsmQuery(route: Point[]): string {
  const bbox = routeBBox(route).join(',');
  const line = simplifyRoute(route).map(p => `${p.lat},${p.lng}`).join(',');
  const around = `around:${Math.max(...Object.values(CONFIG.poi.radii))},${line}`;
  const conditions = [
    '["shop"="convenience"]', '["shop"~"^(supermarket|general|grocery|greengrocer|bakery|deli)$"]',
    '["amenity"="vending_machine"][!"vending"]', '["amenity"="vending_machine"]["vending"~"drinks"]',
    '["amenity"="drinking_water"]', '["man_made"="water_tap"]["drinking_water"="yes"]',
    '["natural"="spring"]["drinking_water"="yes"]', '["amenity"="toilets"]',
    '["name"~"^道の駅"]', '["highway"~"^(rest_area|services)$"]["name"~"道の駅"]',
  ];
  return `[out:json][timeout:25];(node["mountain_pass"="yes"](${bbox});node["natural"="saddle"][name](${bbox});node["natural"="peak"][name](${bbox});${conditions.map(c => `nwr(${around})${c};`).join('')});out body center;`;
}

function poiKind(tags: Record<string, string>): PoiKind | null {
  if (tags.name?.startsWith('道の駅') || (/^(rest_area|services)$/.test(tags.highway ?? '') && tags.name?.includes('道の駅'))) return 'michi';
  if (tags.shop === 'convenience') return 'conv';
  if (/^(supermarket|general|grocery|greengrocer|bakery|deli)$/.test(tags.shop ?? '')) return 'shop';
  if (tags.amenity === 'vending_machine' && (tags.vending === undefined || tags.vending.includes('drinks'))) return 'vend';
  if (tags.amenity === 'drinking_water' || (tags.drinking_water === 'yes' && (tags.man_made === 'water_tap' || tags.natural === 'spring'))) return 'water';
  if (tags.amenity === 'toilets') return 'wc';
  return null;
}

export function splitOsmResponse(elements: OsmElement[]): { places: OsmNode[]; pois: (OsmNode & { type: OsmElement['type']; kind: PoiKind })[] } {
  const places: OsmNode[] = [], pois: (OsmNode & { type: OsmElement['type']; kind: PoiKind })[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const key = `${element.type}/${element.id}`;
    if (seen.has(key)) continue;
    const coords = element.type === 'node' ? element : element.center;
    if (!coords || !validPoint({ lat: coords.lat!, lng: coords.lon! })) continue;
    seen.add(key);
    const tags = element.tags ?? {};
    const node = { id: element.id, lat: coords.lat!, lon: coords.lon!, tags };
    if (element.type === 'node' && (tags.mountain_pass === 'yes' || (['saddle', 'peak'].includes(tags.natural) && tags.name !== undefined))) places.push(node);
    const kind = poiKind(tags);
    if (kind) pois.push({ ...node, type: element.type, kind });
  }
  return { places, pois };
}

export function isOverpassBusy(status: number, body: string): boolean {
  return status === 429 || status === 504 || /rate_limited|timeout/i.test(body);
}
export class OverpassBusyError extends Error {
  constructor() { super('Overpassが混雑中'); }
}

export class OsmProvider {
  private placesCache = new Map<string, OsmNode[]>();
  private poiCache = new Map<string, ReturnType<typeof splitOsmResponse>['pois']>();
  private queue = new RequestQueue(1);
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}
  async get(route: Point[], current = () => true, onBusy: (retrying: boolean) => void = () => {}): Promise<OsmResult> {
    const bbox = routeBBox(route), bboxKey = bbox.join(',');
    if (bbox[2] - bbox[0] > 2 || bbox[3] - bbox[1] > 2) throw new Error('検索範囲が広すぎます（緯度・経度2度以内）');
    const query = buildOsmQuery(route);
    return this.queue.run(async () => {
      const empty = { places: [], pois: [] };
      if (!current()) return empty;
      let places = this.placesCache.get(bboxKey), pois = this.poiCache.get(query);
      if (!places || !pois) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!current()) return empty;
          // POST keeps up to 400 polyline coordinates out of URL length limits.
          const response = await this.request('https://overpass-api.de/api/interpreter', {
            method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(30000),
          });
          const body = await response.text();
          if (!current()) return empty;
          if (isOverpassBusy(response.status, body)) {
            onBusy(attempt === 0);
            if (attempt === 1) throw new OverpassBusyError();
            await new Promise(resolve => setTimeout(resolve, 30000));
            continue;
          }
          if (!response.ok) throw new Error(`Overpass ${response.status}`);
          const data = JSON.parse(body);
          if (!Array.isArray(data.elements) || data.remark) throw new Error('Overpass incomplete response');
          const split = splitOsmResponse(data.elements);
          places ??= split.places;
          pois = split.pois;
          cacheSet(this.placesCache, bboxKey, places, 32);
          cacheSet(this.poiCache, query, pois, 32);
          break;
        }
      }
      return {
        places: places!,
        pois: pois!.map(p => ({ ...p, ...nearestOnRoute({ lat: p.lat, lng: p.lon }, route) }))
          .filter(p => p.offset <= CONFIG.poi.radii[p.kind]),
      };
    });
  }
}
