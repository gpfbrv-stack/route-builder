// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { generateGPX, parseGPX, decimateTrack, gpxFilename } from './gpx';
import type { Place, RouteState } from './types';
const state: RouteState = { name: '京都 & <峠> "旅"', points: [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135.01 }], profile: 'gravel', followRoad: true };
it('round trips exact geometry, elevations, Unicode and editing anchors', () => {
  const track = [{ lat: 35, lng: 135, ele: 0 }, { lat: 35.001234567, lng: 135.005, ele: -1.25 }, { lat: 35.01, lng: 135.01, ele: 100 }];
  const places: Place[] = [{ lat: 35, lng: 135, ele: 42, name: '峠 & 山', id: 1, kind: 'pass', offset: 0, routeDistance: 0, elevationSource: 'OSM' }];
  const result = parseGPX(generateGPX(state, track, places));
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
