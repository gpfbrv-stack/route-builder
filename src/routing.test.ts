import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router, routingWarnings, segmentKey } from './routing';
import { ProfileRegistry } from './brouter-profiles';
import { History, insertWaypoint, removeWaypoint, selectProfile, reprofile } from './state';
import type { RouteState } from './types';
beforeEach(() => { vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function testRouter(fetcher?: typeof fetch) {
  const registry = new ProfileRegistry();
  const ids: Record<string, string> = { 'mtb-jp': 'custom_1', 'trekking-jp': 'custom_2', 'gravel-jp': 'custom_3', 'road-jp': 'custom_4' };
  vi.spyOn(registry, 'id').mockImplementation(async key => ids[key]);
  return new Router(fetcher, registry);
}
const points = Array.from({ length: 5 }, (_, i) => ({ lat: 35 + i / 100, lng: 135 }));
function response() { return new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: [[135, 35], [135, 35.01]] } }] })); }
const mixedState = (): RouteState => ({ name: 'mixed', points: points.slice(0, 4), profile: 'gravel', legProfiles: ['mtb', 'road', 'gravel'], legFollow: [true, false, true], followRoad: true });
it('inherits profiles on append, insertion, deletion and movement, including endpoints', () => {
  const state = mixedState();
  expect(insertWaypoint(state, 4, points[4]).legProfiles).toEqual(['mtb', 'road', 'gravel', 'gravel']);
  expect(insertWaypoint(state, 2, points[4]).legProfiles).toEqual(['mtb', 'road', 'road', 'gravel']);
  expect(removeWaypoint(state, 1).legProfiles).toEqual(['mtb', 'gravel']);
  expect(removeWaypoint(state, 2).legProfiles).toEqual(['mtb', 'road']);
  expect(removeWaypoint(state, 0).legProfiles).toEqual(['road', 'gravel']);
  expect(removeWaypoint(state, 3).legProfiles).toEqual(['mtb', 'road']);
  const moved = { ...state, points: state.points.map((p, i) => i === 2 ? points[4] : p) };
  expect(moved.legProfiles).toEqual(state.legProfiles);
  const empty = { ...state, points: [], legProfiles: [], legFollow: [] };
  const first = insertWaypoint(empty, 0, points[0]);
  expect(first.legProfiles).toEqual([]);
  const second = insertWaypoint(first, 1, points[1]);
  expect(second.legProfiles).toEqual(['gravel']);
  expect(removeWaypoint(second, 0).legProfiles).toEqual([]);
  expect(removeWaypoint(first, 0)).toEqual(empty);
  expect(state.legProfiles).toEqual(['mtb', 'road', 'gravel']);
});
it.each([1, undefined])('undo restores a single reprofile operation (%s)', index => {
  const state = mixedState(), history = new History(state);
  history.set(reprofile(history.value, index));
  expect(history.value.legProfiles).toEqual(index === undefined ? ['gravel', 'gravel', 'gravel'] : ['mtb', 'gravel', 'gravel']);
  expect(history.value.legFollow).toEqual([true, true, true]);
  history.undo(); expect(history.value).toEqual(state); expect(history.canUndo).toBe(false);
});
it('requests only legs whose coordinates or profile change, and reuses cache after Undo', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => response()), router = testRouter(fetcher);
  const history = new History(mixedState());
  await router.route(history.value.points, history.value.legProfiles);
  expect(fetcher).toHaveBeenCalledTimes(3);
  history.value = selectProfile(history.value, 'road');
  await router.route(history.value.points, history.value.legProfiles);
  expect(fetcher).toHaveBeenCalledTimes(3);
  history.set(reprofile(history.value, 0));
  await router.route(history.value.points, history.value.legProfiles);
  expect(fetcher).toHaveBeenCalledTimes(4);
  history.set(reprofile(history.value));
  await router.route(history.value.points, history.value.legProfiles);
  expect(fetcher).toHaveBeenCalledTimes(5);
  history.undo(); history.undo();
  const segments = await router.route(history.value.points, history.value.legProfiles);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(routingWarnings(segments, history.value.legProfiles)).toEqual([]);
  const moved = history.value.points.map((p, i) => i === 1 ? { ...p, lng: p.lng + 0.01 } : p);
  await router.route(moved, history.value.legProfiles);
  expect(fetcher).toHaveBeenCalledTimes(7);
  expect(fetcher.mock.calls.slice(-2).map(([url]) => new URL(String(url)).searchParams.get('profile'))).toEqual(['custom_1', 'custom_4']);
});
it('checks warnings against each leg profile', () => {
  expect(routingWarnings([
    { points: [], fallback: false, profileUsed: 'road-jp' },
    { points: [], fallback: false, profileUsed: 'trekking-jp' },
    { points: [], fallback: false, profileUsed: 'gravel-jp' },
  ], ['road', 'mtb', 'gravel'])).toEqual(['一部区間を代替経路(trekking-jp)で計算しました']);
});
it('retries mtb with trekking and caches the alternative under the requested profile and segment', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('no track found at pass=0', { status: 400 }))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response());
  const router = testRouter(fetcher);
  const segment = await router.segment(points[0], points[1], 'mtb');
  expect(segment).toEqual({ points: points.slice(0, 2), fallback: false, profileUsed: 'trekking-jp' });
  expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get('profile'))).toEqual(['custom_1', 'custom_2']);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('lonlats')).toBe(new URL(fetcher.mock.calls[1][0]).searchParams.get('lonlats'));
  expect(await router.segment(points[0], points[1], 'mtb')).toEqual(segment);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await router.segment(points[0], points[1], 'gravel')).profileUsed).toBe('gravel-jp');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('uses a straight line after both profiles fail, without caching the failure', async () => {
  const fetcher = vi.fn(async () => new Response('no track found at pass=0', { status: 400 }));
  const router = testRouter(fetcher);
  expect(await router.segment(points[0], points[1], 'mtb')).toEqual({ points: points.slice(0, 2), fallback: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await router.segment(points[0], points[1], 'mtb');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it.each(['gravel', 'road'] as const)('does not try alternatives for %s', async profile => {
  const fetcher = vi.fn(async () => new Response('no track found at pass=0', { status: 400 }));
  expect((await testRouter(fetcher).segment(points[0], points[1], profile)).fallback).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('refetches only the two neighbours after a drag', async () => {
  const fetcher = vi.fn(async () => response()); const router = testRouter(fetcher);
  await router.route(points, 'mtb'); expect(fetcher).toHaveBeenCalledTimes(4);
  await router.route(points.map((p, i) => i === 2 ? { ...p, lng: 135.001 } : p), 'mtb');
  expect(fetcher).toHaveBeenCalledTimes(6);
  await router.route(points, 'road'); expect(fetcher).toHaveBeenCalledTimes(10);
});
it('limits concurrency and shares in-flight requests', async () => {
  let active = 0; let peak = 0;
  const fetcher = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return response(); });
  const router = testRouter(fetcher);
  await Promise.all([router.route(points, 'mtb'), router.route(points, 'mtb')]);
  expect(peak).toBeLessThanOrEqual(2); expect(fetcher).toHaveBeenCalledTimes(4);
});
it('falls back without poisoning cache', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  const router = testRouter(fetcher);
  expect((await router.segment(points[0], points[1], 'mtb')).fallback).toBe(true);
  expect((await router.segment(points[0], points[1], 'mtb')).fallback).toBe(false);
});
it('stops scheduling obsolete segments', async () => {
  const fetcher = vi.fn(async () => response());
  expect(await testRouter(fetcher).route(points, 'mtb', () => false)).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});
it('publishes each resolved leg before the full route and never publishes an obsolete result', async () => {
  const replies: ((response: Response) => void)[] = [];
  const router = testRouter(vi.fn(() => new Promise<Response>(resolve => replies.push(resolve))));
  let current = true;
  const resolved = vi.fn(), route = router.route(points.slice(0, 3), 'road', () => current, resolved);
  await vi.waitFor(() => expect(replies).toHaveLength(2));
  replies[1](response());
  await vi.waitFor(() => expect(resolved).toHaveBeenCalledTimes(1));
  expect(resolved.mock.calls[0][0]).toBe(1);
  expect(router.cached(points[1], points[2], 'road')).toBe(resolved.mock.calls[0][1]);
  current = false; replies[0](response()); await route;
  expect(resolved).toHaveBeenCalledTimes(1);
});
it('calls browser fetch without a Router receiver', async () => {
  vi.stubGlobal('fetch', function(this: unknown) { if (this instanceof Router) throw new Error('Illegal invocation'); return Promise.resolve(response()); });
  try { expect((await testRouter().segment(points[0], points[1], 'mtb')).fallback).toBe(false); }
  finally { vi.unstubAllGlobals(); }
});

const registration = (id: number) => new Response(JSON.stringify({ profileid: `custom_${id}` }));
it('uses custom IDs over the wire and logical keys in profileUsed, sharing registration across segments', async () => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST' ? registration(1) : response());
  const router = new Router(fetcher);
  const segments = await router.route(points, 'road');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([, init]) => !init?.method).map(([url]) => new URL(String(url)).searchParams.get('profile'))).toEqual(Array(4).fill('custom_1'));
  expect(segments.every(s => s.profileUsed === 'road-jp')).toBe(true);
  expect(routingWarnings(segments, 'road')).toEqual([]);
  expect(segmentKey(points[0], points[1], 'road')).toBe('road:true:135.000000,35.000000|135.000000,35.010000');
});
it('re-registers once after HTTP 500 and caches the successful retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(registration(1)).mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockResolvedValueOnce(registration(2)).mockResolvedValueOnce(response());
  const router = new Router(fetcher);
  const result = await router.segment(points[0], points[1], 'road');
  expect(result.profileUsed).toBe('road-jp');
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('profile')).toBe('custom_1');
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('profile')).toBe('custom_2');
  expect(await router.segment(points[0], points[1], 'road')).toBe(result);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('uses the standard profile and preserves its warning in cache when re-registration fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(registration(1)).mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  const router = new Router(fetcher);
  const result = await router.segment(points[0], points[1], 'road');
  expect(result).toMatchObject({ profileUsed: 'fastbike', standardProfile: true, fallback: false });
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('profile')).toBe('fastbike');
  expect(routingWarnings([await router.segment(points[0], points[1], 'road')], 'road')).toEqual(['日本向け設定を使えず標準設定で計算しました']);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('uses the standard profile when initial registration fails, without retrying a standard HTTP 500', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response('', { status: 500 }));
  expect((await new Router(fetcher).segment(points[0], points[1], 'road')).fallback).toBe(true);
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('profile')).toBe('fastbike');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('stops after a second custom HTTP 500', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(registration(1)).mockResolvedValueOnce(new Response('', { status: 500 }))
    .mockResolvedValueOnce(registration(2)).mockResolvedValueOnce(new Response('', { status: 500 }));
  expect((await new Router(fetcher).segment(points[0], points[1], 'road')).fallback).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('registers trekking-jp after mtb-jp finds no track', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(registration(1)).mockResolvedValueOnce(new Response('no track found', { status: 400 }))
    .mockResolvedValueOnce(registration(2)).mockResolvedValueOnce(response());
  const result = await new Router(fetcher).segment(points[0], points[1], 'mtb');
  expect(result.profileUsed).toBe('trekking-jp');
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('profile')).toBe('custom_2');
  expect(routingWarnings([result], 'mtb')).toEqual(['一部区間を代替経路(trekking-jp)で計算しました']);
});
it('uses standard trekking if registering the alternative fails', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(registration(1)).mockResolvedValueOnce(new Response('no track found', { status: 400 }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  const result = await new Router(fetcher).segment(points[0], points[1], 'mtb');
  expect(result).toMatchObject({ profileUsed: 'trekking', standardProfile: true });
  expect(new URL(fetcher.mock.calls[3][0]).searchParams.get('profile')).toBe('trekking');
  expect(routingWarnings([result], 'mtb')).toEqual(['日本向け設定を使えず標準設定で計算しました', '一部区間を代替経路(trekking)で計算しました']);
});
it('shares one replacement registration for concurrent expired-ID failures', async () => {
  let registrations = 0;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return registration(++registrations);
    return new URL(String(url)).searchParams.get('profile') === 'custom_1' ? new Response('', { status: 500 }) : response();
  });
  const results = await new Router(fetcher).route(points.slice(0, 3), 'road');
  expect(registrations).toBe(2);
  expect(results.every(s => s.profileUsed === 'road-jp' && !s.fallback)).toBe(true);
});

it('inherits follow settings on append, split, move and removal without mutating the source', () => {
  const state = { ...mixedState(), followRoad: false };
  expect(insertWaypoint(state, 4, points[4]).legFollow).toEqual([true, false, true, false]);
  expect(insertWaypoint(state, 2, points[4]).legFollow).toEqual([true, false, false, true]);
  expect(insertWaypoint(state, 1, points[4]).legFollow).toEqual([true, true, false, true]);
  expect(insertWaypoint(state, 0, points[4]).legFollow).toEqual([true, true, false, true]);
  expect(removeWaypoint(state, 1).legFollow).toEqual([true, true]);
  expect(removeWaypoint(state, 2).legFollow).toEqual([true, false]);
  expect(removeWaypoint(state, 0).legFollow).toEqual([false, true]);
  expect(removeWaypoint(state, 3).legFollow).toEqual([true, false]);
  const history = new History(state);
  history.set({ ...state, points: state.points.map((p, i) => i === 1 ? points[4] : p) });
  expect(history.value.legFollow).toEqual([true, false, true]); history.undo(); expect(history.value).toEqual(state);
  const first = insertWaypoint({ ...state, points: [], legProfiles: [], legFollow: [] }, 0, points[0]);
  expect(first.legFollow).toEqual([]);
  expect(insertWaypoint(first, 1, points[1]).legFollow).toEqual([false]);
  expect(removeWaypoint(first, 0).legFollow).toEqual([]);
  expect(state.legFollow).toEqual([true, false, true]);
});
it.each([0, undefined])('redraws both settings and restores both with one undo (%s)', index => {
  const state = { ...mixedState(), followRoad: false }, history = new History(state);
  history.set(reprofile(state, index));
  expect(history.value.legFollow).toEqual(index === 0 ? [false, false, true] : [false, false, false]);
  expect(history.value.legProfiles).toEqual(index === 0 ? ['gravel', 'road', 'gravel'] : ['gravel', 'gravel', 'gravel']);
  history.undo(); expect(history.value).toEqual(state); expect(history.canUndo).toBe(false);
});
it('never requests straight legs, including when a road result is cached, and keeps mixed results ordered', async () => {
  const fetcher = vi.fn(async () => response()), router = testRouter(fetcher), state = mixedState();
  const run = (follow: boolean[]) => router.route(state.points, state.legProfiles, undefined, undefined, follow);
  const straight = await run([false, false, false]); expect(fetcher).not.toHaveBeenCalled();
  expect(straight.map(s => s.points)).toEqual(state.points.slice(1).map((p, i) => [state.points[i], p]));
  const mixed = await run(state.legFollow); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(mixed[1]).toEqual({ points: [points[1], points[2]], fallback: false });
  expect(routingWarnings(mixed, state.legProfiles)).toEqual([]);
  expect(await run([false, false, false])).toEqual(straight); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(router.cached(points[0], points[1], 'mtb', false)).toBeUndefined();
  expect(router.cached(points[0], points[1], 'mtb', true)).toBeDefined();
  expect(segmentKey(points[0], points[1], 'mtb', false)).not.toBe(segmentKey(points[0], points[1], 'mtb', true));
  await expect(run([])).rejects.toThrow();
});
