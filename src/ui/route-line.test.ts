// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router } from '../routing';
import { insertWaypoint, removeWaypoint } from '../state';
import type { RouteState } from '../types';
import { RouteLine } from './route-line';

let map: L.Map;
beforeEach(() => {
  document.body.innerHTML = '<div id="map"></div>';
  Object.defineProperty(L.Browser, 'svg', { configurable: true, value: true });
  map = L.map('map').setView([35, 135], 10);
});
afterEach(() => map.remove());
const state = (): RouteState => ({ name: 'test', profile: 'road', legProfiles: ['mtb', 'road'], legMode: ['road', 'road'], mode: 'road' as const,
  points: [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135.02 }, { lat: 35.03, lng: 135.04 }] });
const paths = () => [...document.querySelectorAll<SVGPathElement>('.route-line')];
const curve = [{ lat: 35, lng: 135 }, { lat: 35.015, lng: 135 }, { lat: 35.01, lng: 135.02 }];
it('replaces a leg after a preference change and ignores the previous preference result', () => {
  const view = new RouteLine(map, new Router()), initial = { ...state(), legPrefer: ['main', 'main'] as const };
  const main: RouteState = { ...initial, legPrefer: [...initial.legPrefer] };
  view.update(main); const original = paths()[1];
  view.update({ ...main, legPrefer: ['main', 'side'] });
  expect(original.isConnected).toBe(false);
  view.resolveState(main, 1, { points: curve, fallback: false });
  expect(view.shapes[1]).toEqual(main.points.slice(1));
  expect(paths().at(-1)!.hasAttribute('stroke-dasharray')).toBe(true);
});
it('keeps the exact routed path and Leaflet element when appending, replacing only the new dashed leg', () => {
  const view = new RouteLine(map, new Router()), initial: RouteState = { ...state(), points: state().points.slice(0, 2), legProfiles: state().legProfiles.slice(0, 1), legMode: ['road'] };
  view.update(initial); view.resolve(0, { points: curve, fallback: false });
  const original = paths()[0], geometry = original.getAttribute('d');
  view.update(insertWaypoint(initial, 2, state().points[2]));
  expect(paths()[0]).toBe(original); expect(paths()[0].getAttribute('d')).toBe(geometry);
  expect(view.shapes[0]).toEqual(curve);
  expect(paths()[1].getAttribute('stroke-dasharray')).toBe('6 8');
  expect(paths()[1].getAttribute('stroke-opacity')).toBe('0.6');
  expect(paths()[1].getAttribute('stroke-width')).toBe('4');
  expect(paths()[1].getAttribute('stroke')).toBe('var(--route)');
  const addedCurve = [initial.points[1], { lat: 35.02, lng: 135.02 }, state().points[2]];
  view.resolve(1, { points: addedCurve, fallback: false });
  expect(paths()[1].hasAttribute('stroke-dasharray')).toBe(false);
  expect(paths()[1].getAttribute('stroke-opacity')).toBe('0.7');
  expect(document.querySelector('path[stroke="var(--route-casing)"]')!.getAttribute('stroke-opacity')).toBe('0.5');
  expect(paths()[0]).toBe(original); expect(view.shapes[1]).toEqual(addedCurve);
  expect(view.hit.options).toMatchObject({ weight: 24, opacity: 0, interactive: true });
});
it('resolves each leg independently and preserves unaffected legs on insertion, movement and deletion', () => {
  const view = new RouteLine(map, new Router()), initial = state();
  view.update(initial);
  view.resolve(1, { points: [initial.points[1], { lat: 35.04, lng: 135.01 }, initial.points[2]], fallback: false });
  expect(paths()[0].getAttribute('stroke-dasharray')).toBe('6 8');
  expect(paths()[1].hasAttribute('stroke-dasharray')).toBe(false);
  const original = paths()[1], geometry = original.getAttribute('d');
  const inserted = insertWaypoint(initial, 1, { lat: 35.005, lng: 135.005 });
  view.update(inserted);
  expect(paths().filter(p => p.getAttribute('stroke-dasharray') === '6 8')).toHaveLength(2);
  expect(original.isConnected).toBe(true); expect(original.getAttribute('d')).toBe(geometry);
  view.update({ ...inserted, points: inserted.points.map((p, i) => i === 1 ? { ...p, lat: 35.006 } : p) });
  expect(original.isConnected).toBe(true); expect(original.getAttribute('d')).toBe(geometry);
  view.update(removeWaypoint(inserted, 1));
  expect(original.isConnected).toBe(true); expect(original.getAttribute('d')).toBe(geometry);
  expect(view.shapes).toHaveLength(2);
});
it('draws straight mode and imported tracks solid and clears all paths for an empty route', () => {
  const view = new RouteLine(map, new Router());
  view.update({ ...state(), legMode: ['straight', 'straight'] });
  expect(paths().every(p => !p.hasAttribute('stroke-dasharray'))).toBe(true);
  view.update({ ...state(), importedTrack: curve });
  expect(view.shapes).toEqual([curve]); expect(paths()).toHaveLength(1);
  expect(paths()[0].hasAttribute('stroke-dasharray')).toBe(false);
  view.update({ ...state(), points: [], legProfiles: [], legMode: [] });
  expect(paths()).toHaveLength(0); expect(view.hit.getLatLngs()).toEqual([]);
});
it('applies an ongoing normal calculation only to matching legs while an insertion shifts their indices', () => {
  const view = new RouteLine(map, new Router()), initial = state();
  view.update(initial);
  const preview = insertWaypoint(initial, 1, { lat: 35.005, lng: 135.005 });
  view.update(preview);
  const untouched = [initial.points[1], { lat: 35.04, lng: 135.01 }, initial.points[2]];
  view.resolveState(initial, 1, { points: untouched, fallback: false });
  expect(view.shapes[2]).toEqual(untouched);
  expect(paths().filter(p => p.hasAttribute('stroke-dasharray'))).toHaveLength(2);
  view.resolveState(initial, 0, { points: curve, fallback: false });
  expect(view.shapes.slice(0, 2)).toEqual([[initial.points[0], preview.points[1]], [preview.points[1], initial.points[1]]]);
});

it('preserves routed paths when the default changes and ignores stale results after a leg becomes straight', () => {
  const view = new RouteLine(map, new Router()), initial = state();
  view.update(initial); view.resolve(0, { points: curve, fallback: false });
  const original = paths()[0], geometry = original.getAttribute('d');
  view.update({ ...initial, mode: 'straight' as const });
  expect(paths()[0]).toBe(original); expect(original.getAttribute('d')).toBe(geometry); expect(view.shapes[0]).toEqual(curve);
  view.update({ ...initial, legMode: ['straight', 'road'] });
  view.resolveState(initial, 0, { points: curve, fallback: false });
  expect(view.shapes[0]).toEqual(initial.points.slice(0, 2));
  expect(original.isConnected).toBe(false);
  expect(paths().at(-1)!.hasAttribute('stroke-dasharray')).toBe(false);
});

it('draws GSI dashed while pending and restores its own cached geometry without BRouter geometry', () => {
  const router = new Router(), cached = vi.spyOn(router, 'cached');
  const initial: RouteState = { ...state(), legMode: ['gsi', 'straight'] };
  const view = new RouteLine(map, router);
  view.update(initial); expect(paths()[0].getAttribute('stroke-dasharray')).toBe('6 8');
  expect(cached).toHaveBeenCalledWith(initial.points[0], initial.points[1], 'mtb', 'gsi', undefined);
  cached.mockReturnValue({ points: curve, fallback: false, gsi: true });
  view.update(initial);
  expect(view.shapes[0]).toEqual(curve); expect(paths()[0].hasAttribute('stroke-dasharray')).toBe(false);
  expect(view.shapes[1]).toEqual(initial.points.slice(1));
  const original = paths()[0];
  view.update({ ...initial, legProfiles: ['gravel', 'road'], mode: 'road' });
  expect(paths()[0]).not.toBe(original); expect(view.shapes[0]).toEqual(curve);
});
