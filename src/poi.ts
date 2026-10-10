import { CONFIG } from './config';
import type { OsmPoi, PoiKind } from './osm';
import type { Poi } from './types';

export function classifyPoi(tags: Record<string, string>): PoiKind | null {
  if (tags.name?.startsWith('道の駅') || (/^(rest_area|services)$/.test(tags.highway ?? '') && tags.name?.includes('道の駅'))) return 'michi';
  if (tags.shop === 'convenience') return 'conv';
  if (/^(supermarket|general|grocery|greengrocer|bakery|deli)$/.test(tags.shop ?? '')) return 'shop';
  if (tags.amenity === 'vending_machine' && (tags.vending === undefined || tags.vending.includes('drinks'))) return 'vend';
  if (tags.amenity === 'drinking_water' || (tags.drinking_water === 'yes' && (tags.man_made === 'water_tap' || tags.natural === 'spring'))) return 'water';
  if (tags.amenity === 'toilets') return 'wc';
  return null;
}

export function sortPois<T extends { routeDistance: number }>(pois: T[]): T[] {
  return [...pois].sort((a, b) => a.routeDistance - b.routeDistance);
}
export function preparePois(pois: OsmPoi[]): Poi[] {
  return sortPois(pois.map(p => ({
    id: p.type + '/' + p.id, lat: p.lat, lng: p.lon, kind: p.kind,
    routeDistance: p.routeDistance, offset: p.offset,
    name: p.tags?.['name:ja'] || p.tags?.name || p.tags?.brand || CONFIG.poi.categories[p.kind].label,
    hours: p.tags?.opening_hours === '24/7' ? '24時間' : p.tags?.opening_hours,
    count: 1,
  })));
}
// The first machine represents each group; its position, offset and hours stay together.
export function groupVending(pois: Poi[]): Poi[] {
  const result: Poi[] = [];
  let group: Poi | undefined, previousDistance = -Infinity;
  for (const poi of sortPois(pois)) {
    if (poi.kind !== 'vend') { result.push({ ...poi }); continue; }
    if (group && poi.routeDistance - previousDistance <= 200) {
      group.count += poi.count;
      group.name = '自販機 ' + group.count + '台';
    } else { group = { ...poi }; result.push(group); }
    previousDistance = poi.routeDistance;
  }
  return result;
}
export function longestSupplyGap(pois: Pick<Poi, 'kind' | 'routeDistance'>[], length: number): { from: number; to: number } {
  const supply = sortPois(pois.filter(p => ['conv', 'shop', 'michi'].includes(p.kind) && p.routeDistance >= 0 && p.routeDistance <= length));
  let from = 0, gap = { from: 0, to: 0 };
  for (const to of [...supply.map(p => p.routeDistance), length]) {
    if (to - from > gap.to - gap.from) gap = { from, to };
    from = to;
  }
  return gap;
}
