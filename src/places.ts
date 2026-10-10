import { CONFIG } from './config';
import { cacheSet, RequestQueue } from './async';
import { nearestOnRoute, validPoint } from './geo';
import type { Place, Point } from './types';
export interface OsmNode { id: number; lat: number; lon: number; tags?: Record<string, string> }
export function routeBBox(route: Point[]) {
  if (!route.length) throw new Error('Empty route');
  let south = 90, west = 180, north = -90, east = -180;
  for (const p of route) { south = Math.min(south, p.lat); north = Math.max(north, p.lat); west = Math.min(west, p.lng); east = Math.max(east, p.lng); }
  const m = CONFIG.places.marginDegrees;
  return [Math.max(-85, Math.floor((south - m) * 100) / 100), Math.max(-180, Math.floor((west - m) * 100) / 100), Math.min(85, Math.ceil((north + m) * 100) / 100), Math.min(180, Math.ceil((east + m) * 100) / 100)];
}
export function parseEle(text?: string): number | null {
  if (!text || !/^[+-]?\d+(?:\.\d+)?\s*(?:m)?$/.test(text.trim())) return null;
  const value = Number.parseFloat(text); return Number.isFinite(value) ? value : null;
}
export function filterPlaces(nodes: OsmNode[], route: Point[]): Place[] {
  const unique = new Map<number, Place>();
  for (const node of nodes) {
    const p = { lat: node.lat, lng: node.lon }; if (!validPoint(p)) continue;
    const tags = node.tags ?? {};
    const kind = tags.mountain_pass === 'yes' || tags.natural === 'saddle' ? 'pass' : tags.natural === 'peak' ? 'peak' : null;
    if (!kind) continue;
    const nearest = nearestOnRoute(p, route);
    if (nearest.offset > (kind === 'peak' ? CONFIG.places.peakRadiusM : CONFIG.places.passRadiusM)) continue;
    const ele = parseEle(tags.ele);
    unique.set(node.id, { ...p, ...nearest, id: node.id, name: tags['name:ja'] || tags.name || '名称未登録の峠', kind, ele, elevationSource: ele === null ? 'unknown' : 'OSM' });
  }
  return [...unique.values()].sort((a, b) => a.routeDistance - b.routeDistance);
}
export class PlaceProvider {
  private cache = new Map<string, OsmNode[]>();
  private queue = new RequestQueue(1);
  constructor(private request: typeof fetch = fetch) {}
  async get(route: Point[], current = () => true): Promise<Place[]> {
    const bbox = routeBBox(route), key = bbox.join(',');
    if (bbox[2] - bbox[0] > 2 || bbox[3] - bbox[1] > 2) throw new Error('検索範囲が広すぎます（緯度・経度2度以内）');
    return this.queue.run(async () => {
      if (!current()) return [];
      let nodes = this.cache.get(key);
      if (!nodes) {
        const query = `[out:json][timeout:25];(node["mountain_pass"="yes"](${key});node["natural"="saddle"][name](${key});node["natural"="peak"][name](${key}););out body;`;
        const url = new URL('https://overpass-api.de/api/interpreter'); url.searchParams.set('data', query);
        const response = await this.request(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Overpass ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.elements) || data.remark) throw new Error('Overpass incomplete response');
        nodes = data.elements as OsmNode[]; cacheSet(this.cache, key, nodes, 32);
      }
      return filterPlaces(nodes, route);
    });
  }
}
