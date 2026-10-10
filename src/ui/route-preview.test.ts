import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router } from '../routing';
import { ProfileRegistry } from '../brouter-profiles';
import type { RouteState, Segment } from '../types';
import { RoutePreview } from './route-preview';
import { insertWaypoint } from '../state';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const state = (delta = 0): RouteState => ({ name: 'live', profile: 'mtb', mode: 'road' as const, legProfiles: ['road', 'gravel', 'mtb'], legMode: ['road', 'road', 'road'],
  points: [{ lat: 35, lng: 135 }, { lat: 35.01 + delta, lng: 135.01 }, { lat: 35.02, lng: 135.02 }, { lat: 35.03, lng: 135.03 }] });
function setup() {
  const jobs: { current: () => boolean; resolved: (i: number, s: Segment) => void; finish: () => void }[] = [];
  const router = new Router();
  const route = vi.spyOn(router, 'route').mockImplementation((_points, _profiles, current = () => true, resolved) => new Promise(resolve => {
    jobs.push({ current, resolved: resolved!, finish: () => resolve([]) });
  }));
  const draw = vi.fn(), resolved = vi.fn(), live = new RoutePreview(router, draw, resolved);
  return { live, route, jobs, draw, resolved };
}
it('coalesces movement and requests only neighbouring legs no more often than 400ms', async () => {
  const { live, route, jobs, draw } = setup();
  live.update(state(), 1); await vi.advanceTimersByTimeAsync(0);
  expect(route).toHaveBeenCalledTimes(1);
  expect(route.mock.calls[0].slice(0, 2)).toEqual([state().points.slice(0, 3), ['road', 'gravel']]);
  jobs[0].finish(); await vi.advanceTimersByTimeAsync(100);
  live.update(state(0.001), 1); live.update(state(0.002), 1);
  expect(draw).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(299); expect(route).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(route).toHaveBeenCalledTimes(2);
  expect(route.mock.calls[1][0][1]).toEqual(state(0.002).points[1]);
  jobs[1].finish(); live.cancel();
});
it('discards obsolete and cancelled results and avoids queuing old positions while a request is slow', async () => {
  const { live, route, jobs, resolved } = setup();
  live.update(state(), 1); await vi.advanceTimersByTimeAsync(0);
  live.update(state(0.001), 1); await vi.advanceTimersByTimeAsync(500);
  live.update(state(0.002), 1); await vi.advanceTimersByTimeAsync(500);
  expect(route).toHaveBeenCalledTimes(1); expect(jobs[0].current()).toBe(false);
  jobs[0].resolved(0, { points: [], fallback: false }); expect(resolved).not.toHaveBeenCalled();
  jobs[0].finish(); await vi.advanceTimersByTimeAsync(1);
  expect(route).toHaveBeenCalledTimes(2); expect(route.mock.calls[1][0][1]).toEqual(state(0.002).points[1]);
  jobs[1].resolved(0, { points: state().points, fallback: false }); expect(resolved).toHaveBeenCalledOnce();
  live.cancel(); expect(jobs[1].current()).toBe(false);
  jobs[1].resolved(1, { points: [], fallback: false }); expect(resolved).toHaveBeenCalledOnce();
  jobs[1].finish(); await vi.advanceTimersByTimeAsync(1000); expect(route).toHaveBeenCalledTimes(2);
});
it('uses inherited profiles for insertion, handles endpoints and makes no requests in straight mode', async () => {
  const { live, route, jobs } = setup();
  const inserted = insertWaypoint(state(), 2, { lat: 35.015, lng: 135.015 });
  live.update(inserted, 2); await vi.advanceTimersByTimeAsync(0);
  expect(route.mock.calls[0].slice(0, 2)).toEqual([inserted.points.slice(1, 4), ['gravel', 'gravel']]);
  jobs[0].finish(); live.cancel();
  live.update(state(), 0); await vi.advanceTimersByTimeAsync(400);
  expect(route.mock.calls[1].slice(0, 2)).toEqual([state().points.slice(0, 2), ['road']]);
  jobs[1].finish(); live.cancel();
  live.update(state(), 3); await vi.advanceTimersByTimeAsync(400);
  expect(route.mock.calls[2].slice(0, 2)).toEqual([state().points.slice(2), ['mtb']]);
  jobs[2].finish(); live.cancel();
  live.update({ ...state(), legMode: ['straight', 'straight', 'straight'] }, 1); await vi.advanceTimersByTimeAsync(1000);
  expect(route).toHaveBeenCalledTimes(3); live.cancel();
});
it('shares the real router concurrency limit with normal calculations and caches live results', async () => {
  const registry = new ProfileRegistry(); vi.spyOn(registry, 'id').mockResolvedValue('custom_1');
  let active = 0, peak = 0;
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 100)); active--;
    const coords = new URL(String(url)).searchParams.get('lonlats')!.split('|').map(p => p.split(',').map(Number));
    return new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: coords } }] }));
  });
  const router = new Router(fetcher, registry), live = new RoutePreview(router, vi.fn(), vi.fn());
  const normal = router.route(state().points, state().legProfiles);
  const moved = state(0.001); live.update(moved, 1);
  await vi.advanceTimersByTimeAsync(1000); await normal;
  expect(peak).toBe(2); expect(fetcher).toHaveBeenCalledTimes(5);
  expect(router.cached(moved.points[0], moved.points[1], 'road')).toBeDefined();
  const drop = router.route(moved.points, moved.legProfiles);
  await vi.advanceTimersByTimeAsync(1000); await drop;
  expect(fetcher).toHaveBeenCalledTimes(5); live.cancel();
});

it('routes mixed neighbours with their own follow settings even when the default is off', async () => {
  const { live, route, jobs } = setup();
  live.update({ ...state(), mode: 'straight' as const, legMode: ['straight', 'road', 'straight'] }, 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(route).toHaveBeenCalledOnce(); expect(route.mock.calls[0][4]).toEqual(['straight', 'road']);
  jobs[0].finish(); live.cancel();
});

it('throttles GSI live routing, uses the leg mode and retains its stored profile', async () => {
  const { live, route, jobs, resolved } = setup();
  const gsiState = (delta = 0): RouteState => ({ ...state(delta), mode: 'straight', legMode: ['gsi', 'straight', 'road'] });
  live.update(gsiState(), 1); await vi.advanceTimersByTimeAsync(0);
  expect(route.mock.calls[0][4]).toEqual(['gsi', 'straight']);
  expect(route.mock.calls[0][1]).toEqual(['road', 'gravel']);
  jobs[0].resolved(0, { points: state().points, fallback: false, gsi: true }); expect(resolved).toHaveBeenCalledOnce();
  jobs[0].finish(); live.update(gsiState(0.001), 1);
  await vi.advanceTimersByTimeAsync(399); expect(route).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(route).toHaveBeenCalledTimes(2);
  jobs[1].finish(); live.cancel();
});
