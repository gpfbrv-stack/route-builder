import { cumulativeDistances } from './geo';
import type { Point, Surface } from './types';

export const SURFACE_LABELS: Record<Surface, string> = { paved: '舗装', unpaved: '未舗装', unknown: '不明' };
const unpaved = new Set('unpaved gravel fine_gravel compacted dirt earth ground grass sand mud pebblestone rock woodchips'.split(' '));
const paved = new Set('asphalt paved concrete paving_stones sett chipseal metal'.split(' '));
export function classifySurface(tags: string): Surface {
  const values = Object.fromEntries(tags.trim().split(/\s+/).map(tag => tag.split('=')));
  const { surface, tracktype, highway } = values;
  if (unpaved.has(surface) || /^grade[2-5]$/.test(tracktype)
    || (!surface && !tracktype && /^(track|path|bridleway)$/.test(highway))) return 'unpaved';
  if (paved.has(surface) || surface?.startsWith('concrete:') || tracktype === 'grade1'
    || (!surface && /^(motorway|trunk|primary|secondary|tertiary)(_link)?$|^(unclassified|residential|living_street|service|cycleway)$/.test(highway))) return 'paved';
  return 'unknown';
}

export function unknownSurface(points: Point[]): Point[] {
  return points.map(({ surface: _surface, ...point }) => point);
}

/** BRouter messages describe incoming edges, ending at each row's coordinate. */
export function applySurfaceMessages(points: Point[], messages: unknown): Point[] {
  const result = unknownSurface(points);
  if (!Array.isArray(messages) || !Array.isArray(messages[0])) return result;
  const header = messages[0], lngColumn = header.indexOf('Longitude'), latColumn = header.indexOf('Latitude'), tagsColumn = header.indexOf('WayTags'), distanceColumn = header.indexOf('Distance');
  if ([lngColumn, latColumn, tagsColumn].some(i => i < 0)) return result;
  // Index rounded coordinates once; repeated visits are consumed in route order.
  const indices = new Map<string, number[]>();
  const key = (lng: number, lat: number) => `${Math.round(lng)},${Math.round(lat)}`;
  points.forEach((p, i) => {
    const id = key(p.lng * 1e6, p.lat * 1e6), list = indices.get(id) ?? [];
    list.push(i); indices.set(id, list);
  });
  let start = 0, uncertain = false;
  for (const row of messages.slice(1)) {
    if (!Array.isArray(row)) { uncertain = true; continue; }
    const lng = Number(row[lngColumn]), lat = Number(row[latColumn]);
    const positiveDistance = distanceColumn >= 0 && Number(row[distanceColumn]) > 0;
    const end = Number.isFinite(lng) && Number.isFinite(lat) ? indices.get(key(lng, lat))?.find(i => positiveDistance ? i > start : i >= start) : undefined;
    if (end === undefined) { uncertain = true; continue; }
    const surface = uncertain || typeof row[tagsColumn] !== 'string' ? 'unknown' : classifySurface(row[tagsColumn]);
    for (let i = start + 1; i <= end; i++) if (surface !== 'unknown') result[i].surface = surface;
    start = end; uncertain = false;
  }
  return result;
}

export interface SurfaceSpan { from: number; to: number; surface: Surface }
export function surfaceSpans(points: Point[]): SurfaceSpan[] {
  const ds = cumulativeDistances(points), spans: SurfaceSpan[] = [];
  for (let i = 1; i < points.length; i++) {
    if (ds[i] === ds[i - 1]) continue;
    const surface = points[i].surface ?? 'unknown', last = spans.at(-1);
    if (last?.surface === surface) last.to = ds[i];
    else spans.push({ from: ds[i - 1], to: ds[i], surface });
  }
  return spans;
}
export function surfaceAt(spans: SurfaceSpan[], distance: number): Surface {
  let lo = 0, hi = spans.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid].to < distance) lo = mid + 1; else hi = mid; }
  const span = spans[lo];
  return span && distance >= span.from && distance <= span.to ? span.surface : 'unknown';
}
export function surfaceTotals(spans: SurfaceSpan[]): Record<Surface, number> {
  const totals = { paved: 0, unpaved: 0, unknown: 0 };
  for (const span of spans) totals[span.surface] += span.to - span.from;
  return totals;
}
export function surfaceSummary(spans: SurfaceSpan[]): string {
  return Object.entries(surfaceTotals(spans)).filter(([, m]) => m > 0)
    .map(([surface, m]) => `${SURFACE_LABELS[surface as Surface]} ${m < 100 ? '<0.1' : (m / 1000).toFixed(1)}km`).join(' · ');
}
