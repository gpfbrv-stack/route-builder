// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { encodeRoute, decodeRoute, saveRoute, loadRoute, validateState, consumeSharedRoute } from './persistence';
import type { RouteState } from './types';
const state: RouteState = { name: '京都 🚲', points: [{ lat: 35.12345678, lng: 135.98765432 }], profile: 'road', legProfiles: [], legMode: [], mode: 'straight' };
const mixed: RouteState = { ...state, points: [{ lat: 35, lng: 135 }, { lat: 35.1, lng: 135 }, { lat: 35.2, lng: 135 }], legProfiles: ['mtb', 'gravel'], legMode: ['road', 'gsi'] };
const hashFor = (data: unknown) => '#route=' + btoa(Array.from(new TextEncoder().encode(JSON.stringify(data)), b => String.fromCharCode(b)).join(''));
it('round trips v4 mixed leg profiles through sharing and storage', () => {
  expect(decodeRoute(encodeRoute(mixed))).toEqual(mixed);
  const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodeRoute(mixed).slice(7).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))));
  expect(raw.v).toBe(4); expect(raw.legMode).toEqual(['road', 'gsi']); expect(raw.legFollow).toBeUndefined(); expect(raw.followRoad).toBeUndefined(); expect(raw.legProfiles).toEqual(['mtb', 'gravel']);
  expect(saveRoute(mixed)).toBe(true); expect(loadRoute()).toEqual(mixed);
});
it('migrates v1 URLs and old storage with the saved profile for every leg', () => {
  const legacy = { ...mixed, mode: undefined, legMode: undefined, followRoad: false, legProfiles: undefined, legFollow: undefined };
  const expected = { ...mixed, legProfiles: ['road', 'road'], legMode: ['straight', 'straight'] };
  expect(decodeRoute(hashFor({ ...legacy, legProfiles: mixed.legProfiles, v: 1 }))).toEqual(expected);
  expect(decodeRoute(encodeRoute(decodeRoute(hashFor({ ...legacy, v: 1 }))))).toEqual(expected);
  localStorage.setItem('route-builder:v1', JSON.stringify(legacy)); expect(loadRoute()).toEqual(expected);
  expect(decodeRoute(hashFor({ ...legacy, v: 1 }))).toEqual(expected);
});
it.each([undefined, null, [], ['road'], ['road', 'constructor'], ['road', 'road', 'road']])('rejects invalid v2 leg profiles (%s)', legProfiles => {
  expect(() => decodeRoute(hashFor({ ...mixed, followRoad: true, v: 2, legProfiles }))).toThrow();
});
it('handles zero and one waypoint with no legs and rejects unknown versions', () => {
  for (const points of [[], state.points]) expect(decodeRoute(encodeRoute({ ...state, points })).legProfiles).toEqual([]);
  expect(() => decodeRoute(hashFor({ ...mixed, v: 5 }))).toThrow();
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
    const legacy = { ...mixed, mode: undefined, legMode: undefined, followRoad, legFollow: undefined };
    const mode = followRoad ? 'road' : 'straight';
    const expected = { ...mixed, mode, legMode: [mode, mode], legProfiles: v === 1 ? ['road', 'road'] : mixed.legProfiles };
    const loaded = decodeRoute(hashFor({ ...legacy, v }));
    expect(loaded).toEqual(expected); expect(decodeRoute(encodeRoute(loaded))).toEqual(expected);
  }
  localStorage.setItem('route-builder:v1', JSON.stringify({ ...mixed, mode: undefined, legMode: undefined, followRoad, legFollow: undefined }));
  expect(loadRoute()?.legMode).toEqual(Array(2).fill(followRoad ? 'road' : 'straight'));
});
it.each([undefined, null, [], [true], [true, 0], [true, 'false'], [true, false, true]])('rejects invalid v3 legFollow (%s)', legFollow => {
  expect(() => decodeRoute(hashFor({ ...mixed, followRoad: false, v: 3, legFollow }))).toThrow();
  if (legFollow !== undefined) expect(() => validateState({ ...mixed, legMode: undefined, legFollow })).toThrow();
});

it('migrates v3 mixed follow settings through v4 URLs and localStorage', () => {
  const legacy = { ...mixed, mode: undefined, legMode: undefined, followRoad: true, legFollow: [false, true] };
  const expected = { ...mixed, mode: 'road', legMode: ['straight', 'road'] };
  expect(decodeRoute(hashFor({ ...legacy, v: 3 }))).toEqual(expected);
  expect(decodeRoute(encodeRoute(decodeRoute(hashFor({ ...legacy, v: 3 }))))).toEqual(expected);
  localStorage.setItem('route-builder:v1', JSON.stringify(legacy)); expect(loadRoute()).toEqual(expected);
});
it.each(['road', 'gsi', 'straight'] as const)('round trips all three modes and default %s in v4 and storage', mode => {
  const value: RouteState = { ...mixed, mode, points: [...mixed.points, { lat: 35.3, lng: 135 }], legProfiles: ['mtb', 'gravel', 'road'], legMode: ['road', 'gsi', 'straight'] };
  expect(decodeRoute(encodeRoute(value))).toEqual(value);
  expect(saveRoute(value)).toBe(true); expect(loadRoute()).toEqual(value);
});
it.each([undefined, null, [], ['gsi'], ['road', true], ['road', 'unknown'], ['road', 'gsi', 'straight']])('rejects invalid v4 modes (%s)', legMode => {
  expect(() => decodeRoute(hashFor({ ...mixed, v: 4, legMode }))).toThrow();
  if (legMode !== undefined) expect(() => validateState({ ...mixed, legMode })).toThrow();
});
it.each([undefined, true, 'unknown', null])('rejects invalid v4 default (%s)', mode => {
  expect(() => decodeRoute(hashFor({ ...mixed, v: 4, mode }))).toThrow();
});
