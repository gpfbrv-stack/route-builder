// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { encodeRoute, decodeRoute, saveRoute, loadRoute, validateState, consumeSharedRoute } from './persistence';
import type { RouteState } from './types';
const state: RouteState = { name: '京都 🚲', points: [{ lat: 35.12345678, lng: 135.98765432 }], profile: 'road', legProfiles: [], legFollow: [], followRoad: false };
const mixed: RouteState = { ...state, points: [{ lat: 35, lng: 135 }, { lat: 35.1, lng: 135 }, { lat: 35.2, lng: 135 }], legProfiles: ['mtb', 'gravel'], legFollow: [true, false] };
const hashFor = (data: unknown) => '#route=' + btoa(Array.from(new TextEncoder().encode(JSON.stringify(data)), b => String.fromCharCode(b)).join(''));
it('round trips v3 mixed leg profiles through sharing and storage', () => {
  expect(decodeRoute(encodeRoute(mixed))).toEqual(mixed);
  const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodeRoute(mixed).slice(7).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))));
  expect(raw.v).toBe(3); expect(raw.legProfiles).toEqual(['mtb', 'gravel']);
  expect(saveRoute(mixed)).toBe(true); expect(loadRoute()).toEqual(mixed);
});
it('migrates v1 URLs and old storage with the saved profile for every leg', () => {
  const legacy = { ...mixed, legProfiles: undefined, legFollow: undefined };
  const expected = { ...mixed, legProfiles: ['road', 'road'], legFollow: [false, false] };
  expect(decodeRoute(hashFor({ ...legacy, v: 1 }))).toEqual(expected);
  expect(decodeRoute(encodeRoute(decodeRoute(hashFor({ ...legacy, v: 1 }))))).toEqual(expected);
  localStorage.setItem('route-builder:v1', JSON.stringify(legacy)); expect(loadRoute()).toEqual(expected);
  expect(decodeRoute(hashFor({ ...mixed, v: 1 }))).toEqual(expected);
});
it.each([undefined, null, [], ['road'], ['road', 'constructor'], ['road', 'road', 'road']])('rejects invalid v2 leg profiles (%s)', legProfiles => {
  expect(() => decodeRoute(hashFor({ ...mixed, v: 2, legProfiles }))).toThrow();
});
it('handles zero and one waypoint with no legs and rejects unknown versions', () => {
  for (const points of [[], state.points]) expect(decodeRoute(encodeRoute({ ...state, points })).legProfiles).toEqual([]);
  expect(() => decodeRoute(hashFor({ ...mixed, v: 4 }))).toThrow();
});
it('round trips Unicode and coordinates in URL-safe format', () => {
  const hash = encodeRoute(state); expect(hash).toMatch(/^#route=[A-Za-z0-9_-]+$/);
  expect(decodeRoute(hash)).toEqual(state);
});
it('rejects malformed or out of range input', () => {
  expect(() => decodeRoute('#route=invalid')).toThrow();
  expect(() => validateState({ ...state, profile: 'constructor' })).toThrow();
  expect(() => validateState({ ...state, points: [{ lat: 100, lng: 0 }] })).toThrow();
});
it('continues when localStorage is denied or full', () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
  expect(saveRoute(state)).toBe(false); spy.mockRestore();
});
it('consumes a shared URL once and then restores autosaved edits', () => {
  window.history.replaceState(null, '', encodeRoute(state));
  expect(consumeSharedRoute()).toEqual(state);
  expect(window.location.hash).toBe('');
  saveRoute({ ...state, name: '変更後のルート' });
  expect(consumeSharedRoute() ?? loadRoute()).toEqual({ ...state, name: '変更後のルート' });
});

it.each([true, false])('migrates v1/v2 and old storage using saved followRoad=%s', followRoad => {
  for (const v of [1, 2]) {
    const legacy = { ...mixed, followRoad, legFollow: undefined };
    const expected = { ...legacy, legFollow: [followRoad, followRoad], legProfiles: v === 1 ? ['road', 'road'] : mixed.legProfiles };
    const loaded = decodeRoute(hashFor({ ...legacy, v }));
    expect(loaded).toEqual(expected); expect(decodeRoute(encodeRoute(loaded))).toEqual(expected);
  }
  localStorage.setItem('route-builder:v1', JSON.stringify({ ...mixed, followRoad, legFollow: undefined }));
  expect(loadRoute()?.legFollow).toEqual([followRoad, followRoad]);
});
it.each([undefined, null, [], [true], [true, 0], [true, 'false'], [true, false, true]])('rejects invalid v3 legFollow (%s)', legFollow => {
  expect(() => decodeRoute(hashFor({ ...mixed, v: 3, legFollow }))).toThrow();
  if (legFollow !== undefined) expect(() => validateState({ ...mixed, legFollow })).toThrow();
});
