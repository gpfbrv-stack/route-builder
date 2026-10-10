// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { generateGPX, parseGPX, decimateTrack, gpxFilename } from './gpx';
import type { Place, Poi, RouteState } from './types';
import { CONFIG } from './config';
const state: RouteState = { name: '京都 & <峠> "旅"', points: [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135.01 }], profile: 'gravel', legProfiles: ['gravel'], followRoad: true };
it('assigns the current profile to all imported legs while retaining geometry and anchors', () => {
  const xml = generateGPX(state, state.points);
  for (const profile of ['mtb', 'road', 'gravel'] as const) {
    const result = parseGPX(xml, profile);
    expect(result.state.profile).toBe(profile);
    expect(result.state.legProfiles).toEqual([profile]);
    expect(result.state.points).toEqual(state.points); expect(result.track).toEqual(state.points);
  }
  const foreign = '<gpx><rte><rtept lat="35" lon="135"/><rtept lat="35.01" lon="135"/></rte></gpx>';
  expect(parseGPX(foreign, 'road').state.legProfiles).toEqual(['road']);
});
it('round trips exact geometry, elevations, Unicode and editing anchors', () => {
  const track = [{ lat: 35, lng: 135, ele: 0 }, { lat: 35.001234567, lng: 135.005, ele: -1.25 }, { lat: 35.01, lng: 135.01, ele: 100 }];
  const places: Place[] = [{ lat: 35, lng: 135, ele: 42, name: '峠 & 山', id: 1, kind: 'pass', offset: 0, routeDistance: 0, elevationSource: 'OSM' }];
  const result = parseGPX(generateGPX(state, track, places), 'gravel');
  expect(result.track).toEqual(track); expect(result.state.points).toEqual(state.points);
  expect(result.state.name).toBe(state.name); expect(result.state.profile).toBe('gravel');
  expect(result.places[0].name).toBe('峠 & 山'); expect(result.places[0].ele).toBe(42);
});
it('supports namespaced GPX without extensions and generates limited anchors', () => {
  const track = Array.from({ length: 2000 }, (_, i) => ({ lat: 35 + i / 10000, lng: 135 }));
  const xml = '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg>' + track.map(p => `<g:trkpt lat="${p.lat}" lon="${p.lng}"/>`).join('') + '</g:trkseg></g:trk></g:gpx>';
  expect(parseGPX(xml).state.points.length).toBeLessThanOrEqual(200);
  expect(decimateTrack(track).at(-1)).toEqual(track.at(-1));
});
it('rejects malformed, unsafe, disconnected or invalid tracks', () => {
  expect(() => parseGPX('<gpx>')).toThrow();
  expect(() => parseGPX('<!DOCTYPE gpx><gpx/>')).toThrow();
  expect(() => parseGPX('<gpx><trk><trkseg><trkpt lat="999" lon="0"/><trkpt lat="0" lon="0"/></trkseg></trk></gpx>')).toThrow();
  expect(() => parseGPX('<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>')).toThrow(/複数/);
  expect(gpxFilename('a/b', new Date(2026, 9, 10))).toBe('a_b_2026-10-10.gpx');
});
it('writes all six POI types and symbols and excludes them from passes on repeated round trips', () => {
  const kinds = ['conv', 'shop', 'vend', 'water', 'wc', 'michi'] as const;
  const pois: Poi[] = kinds.map((kind, i) => ({ kind, id: String(i), name: `補給 & <${kind}> "店"`, lat: 35, lng: 135, count: 1, routeDistance: 0, offset: 0 }));
  const places: Place[] = ['pass', 'peak'].map((kind, i) => ({ kind: kind as Place['kind'], id: i, lat: 35, lng: 135, name: '峠 & 山', ele: 42, routeDistance: 0, offset: 0, elevationSource: 'OSM' }));
  const xml = generateGPX(state, state.points, places, pois);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  const wpts = [...doc.querySelectorAll('wpt')]; expect(wpts).toHaveLength(8);
  expect(wpts.slice(2).map(n => n.querySelector('name')!.textContent)).toEqual(pois.map(p => p.name));
  expect(wpts.slice(2).map(n => n.querySelector('type')!.textContent)).toEqual(kinds.map(k => CONFIG.poi.categories[k].label));
  expect(wpts.slice(2).map(n => n.querySelector('sym')!.textContent)).toEqual(['Convenience Store', 'Convenience Store', 'Drinking Water', 'Drinking Water', 'Restroom', 'Restaurant']);
  const parsed = parseGPX(xml);
  expect(parsed.places.map(p => p.kind)).toEqual(['pass', 'peak']);
  expect(parsed.state.importedPlaces).toHaveLength(2);
  const again = parseGPX(generateGPX(parsed.state, parsed.track, parsed.places, pois));
  expect(again.places).toEqual(parsed.places); expect(again.track).toEqual(state.points);
  expect(new DOMParser().parseFromString(generateGPX(state, state.points, places), 'application/xml').querySelectorAll('wpt')).toHaveLength(2);
});
it('excludes namespaced foreign POI waypoints by type while retaining ordinary waypoints', () => {
  const xml = '<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg><g:trkpt lat="35" lon="135"/><g:trkpt lat="35.01" lon="135"/></g:trkseg></g:trk><g:wpt lat="35" lon="135"><g:type> 水場 </g:type></g:wpt><g:wpt lat="35" lon="135"><g:name>峠</g:name></g:wpt></g:gpx>';
  expect(parseGPX(xml).places.map(p => p.name)).toEqual(['峠']);
});
