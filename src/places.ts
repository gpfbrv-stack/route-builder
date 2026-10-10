import { CONFIG } from './config';
import { OsmProvider } from './osm';
import type { OsmNode } from './osm';
export { routeBBox } from './osm';
export type { OsmNode } from './osm';
import { nearestOnRoute, validPoint } from './geo';
import type { Place, Point } from './types';
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
  private osm: OsmProvider;
  constructor(request: typeof fetch = (...args) => fetch(...args)) { this.osm = new OsmProvider(request); }
  async get(route: Point[], current = () => true): Promise<Place[]> {
    return filterPlaces((await this.osm.get(route, current)).places, route);
  }
}
