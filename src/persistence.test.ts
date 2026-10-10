// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { encodeRoute, decodeRoute, saveRoute, validateState } from './persistence';
import type { RouteState } from './types';
const state: RouteState = { name: '京都 🚲', points: [{ lat: 35.12345678, lng: 135.98765432 }], profile: 'road', followRoad: false };
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
