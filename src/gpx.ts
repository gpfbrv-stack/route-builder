import { cumulativeDistances, nearestOnRoute, validPoint } from './geo';
import { validateState } from './persistence';
import type { Place, Poi, Point, RouteState } from './types';
import { CONFIG, type Profile } from './config';
const NS = 'https://route-builder.local/xmlns/1';
const poiSymbols = { conv: 'Convenience Store', shop: 'Convenience Store', vend: 'Drinking Water', water: 'Drinking Water', wc: 'Restroom', michi: 'Restaurant' };
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
export function generateGPX(state: RouteState, track: Point[], places: Place[] = [], pois: Poi[] = []): string {
  const ele = (p: Point) => Number.isFinite(p.ele) ? `<ele>${p.ele}</ele>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Builder" xmlns="http://www.topografix.com/GPX/1/1" xmlns:rb="${NS}">
<metadata><name>${escapeXml(state.name)}</name></metadata>
${places.map(p => `<wpt lat="${p.lat}" lon="${p.lng}">${ele(p)}<name>${escapeXml(p.name)}</name><type>${p.kind}</type></wpt>`).join('\n')}
${pois.map(p => `<wpt lat="${p.lat}" lon="${p.lng}">${ele(p)}<name>${escapeXml(p.name)}</name><sym>${poiSymbols[p.kind]}</sym><type>${CONFIG.poi.categories[p.kind].label}</type></wpt>`).join('\n')}
<trk><name>${escapeXml(state.name)}</name><trkseg>
${track.map(p => `<trkpt lat="${p.lat}" lon="${p.lng}">${ele(p)}</trkpt>`).join('\n')}
</trkseg></trk>
<extensions><rb:editing>${escapeXml(JSON.stringify({ name: state.name, points: state.points, profile: state.profile, followRoad: state.followRoad }))}</rb:editing></extensions>
</gpx>`;
}
export function decimateTrack(track: Point[]): Point[] {
  if (track.length <= 2) return track.map(p => ({ lat: p.lat, lng: p.lng }));
  const ds = cumulativeDistances(track), step = Math.max(500, ds.at(-1)! / 198);
  const result = [track[0]]; let last = 0;
  for (let i = 1; i < track.length - 1; i++) if (ds[i] - last >= step) { result.push(track[i]); last = ds[i]; }
  result.push(track.at(-1)!);
  return result.map(p => ({ lat: p.lat, lng: p.lng }));
}
export function parseGPX(xml: string, profile: Profile = 'mtb', followRoad = true): { state: RouteState; track: Point[]; places: Place[] } {
  if (xml.length > 20_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('GPXが大きすぎるか、未対応のXML形式です');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'gpx') throw new Error('GPXを解析できません');
  const all = (parent: Document | Element, name: string) => Array.from(parent.getElementsByTagNameNS('*', name));
  const text = (node: Element, tag: string) => Array.from(node.children).find(c => c.localName === tag)?.textContent?.trim() ?? '';
  const point = (node: Element): Point => {
    if (!node.hasAttribute('lat') || !node.hasAttribute('lon') || !node.getAttribute('lat')!.trim() || !node.getAttribute('lon')!.trim()) throw new Error('GPX座標がありません');
    const p: Point = { lat: Number(node.getAttribute('lat')), lng: Number(node.getAttribute('lon')) };
    const e = text(node, 'ele'); if (e && Number.isFinite(Number(e))) p.ele = Number(e);
    if (!validPoint(p)) throw new Error('GPX座標が範囲外です'); return p;
  };
  const segments = all(doc, 'trkseg').map(s => all(s, 'trkpt')).filter(s => s.length);
  if (segments.length > 1) throw new Error('複数トラック区間のGPXには未対応です。1区間のGPXを使用してください。');
  const track = (segments[0] ?? all(doc, 'rtept')).map(point);
  if (track.length < 2 || track.length > 100000) throw new Error('GPXは2〜100,000点のトラックが必要です');
  const name = all(doc, 'trk').map(n => text(n, 'name')).find(Boolean) || all(doc, 'metadata').map(n => text(n, 'name')).find(Boolean) || '読み込んだルート';
  let state = validateState({ name: name.slice(0, 200), points: decimateTrack(track), profile, followRoad, importedTrack: track });
  const editing = doc.getElementsByTagNameNS(NS, 'editing')[0]?.textContent;
  if (editing) { try { state = { ...validateState(JSON.parse(editing)), importedTrack: track }; } catch { /* foreign or damaged extension: keep track */ } }
  state.profile = profile;
  state.followRoad = followRoad;
  state.legFollow = Array(Math.max(0, state.points.length - 1)).fill(followRoad);
  state.legProfiles = Array(Math.max(0, state.points.length - 1)).fill(profile);
  const poiTypes = new Set<string>(Object.values(CONFIG.poi.categories).map(category => category.label));
  const places: Place[] = all(doc, 'wpt').filter(n => !poiTypes.has(text(n, 'type'))).map((n, i) => {
    const p = point(n); return { ...p, ...nearestOnRoute(p, track), id: -i - 1, name: text(n, 'name') || '名称未登録', kind: text(n, 'type') === 'peak' ? 'peak' : 'pass', elevationSource: 'unknown' };
  });
  state.importedPlaces = places;
  return { state: validateState(state), track, places };
}
export function gpxFilename(name: string, date = new Date()): string {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 80) || 'route';
  return `${safe}_${day}.gpx`;
}
