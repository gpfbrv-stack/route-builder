import { CONFIG } from './config';
import { OsmProvider } from './osm';
import type { OsmNode } from './osm';
export { routeBBox } from './osm';
export type { OsmNode } from './osm';
import { distance, nearestOnRoute, validPoint } from './geo';
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

// Ignore parenthesized readings, but do not normalize spelling differences.
const placeName = (name: string) => name.replace(/[（(][ぁ-ゖァ-ヺー\s・]+[）)]/g, '').trim();
export function mergePlaces(gsi: Place[], osm: Place[]): Place[] {
  const result = gsi.map(p => ({ ...p }));
  for (const place of osm) {
    const index = result.findIndex(p => placeName(p.name) === placeName(place.name) && distance(p, place) <= 500);
    if (index < 0) result.push({ ...place });
    else if (place.elevationSource === 'OSM' && place.ele != null) result[index] = { ...place };
  }
  return result.sort((a, b) => a.routeDistance - b.routeDistance);
}

export async function progressivePlaces(
  gsi: Promise<Place[]>, osm: Promise<Place[]>,
  publish: (places: Place[]) => void, current = () => true,
): Promise<void> {
  let first: Place[] = [], second: Place[] = [];
  await Promise.allSettled([
    gsi.then(places => { first = places; if (current()) publish(mergePlaces(first, second)); }),
    osm.then(places => { second = places; if (current()) publish(mergePlaces(first, second)); }),
  ]);
}
