import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router, routingWarnings, segmentKey, isDetour, endpointHighways } from './routing';
import { ProfileRegistry } from './brouter-profiles';
import { History, insertWaypoint, removeWaypoint, selectProfile, selectMode, defaultLegMode, reprofile, preferLeg, autoPreferWaypoint } from './state';
import { GsiRouter } from './gsi-router';
import type { LegMode, RouteState, Segment } from './types';
import * as geo from './geo';
beforeEach(() => { vi.spyOn(GsiRouter.prototype, 'route').mockRejectedValue(new Error('no GSI path')); vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function testRouter(fetcher?: typeof fetch) {
  const registry = new ProfileRegistry();
  const ids: Record<string, string> = { 'mtb-jp': 'custom_1', 'trekking-jp': 'custom_2', 'gravel-jp': 'custom_3', 'road-jp': 'custom_4' };
  vi.spyOn(registry, 'id').mockImplementation(async key => ids[key]);
  return new Router(fetcher, registry);
}
const points = Array.from({ length: 5 }, (_, i) => ({ lat: 35 + i / 100, lng: 135 }));
function response() { return new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: [[135, 35], [135, 35.01]] } }] })); }
function surfaceResponse() { return new Response(JSON.stringify({ features: [{
  geometry: { type: 'LineString', coordinates: [[135, 35], [135, 35.005], [135, 35.01]] },
  properties: { messages: [['Longitude', 'Latitude', 'Distance', 'WayTags'], ['135000000', '35005000', '556', 'surface=asphalt'], ['135000000', '35010000', '556', 'surface=gravel']] },
}] })); }
it('attaches surface at BRouter boundaries and retains it in the segment cache', async () => {
  const fetcher = vi.fn(async () => surfaceResponse()), router = testRouter(fetcher);
  const result = await router.segment(points[0], points[1], 'road');
  expect(result.points.map(p => p.surface ?? 'unknown')).toEqual(['unknown', 'paved', 'unpaved']);
  expect(await router.segment(points[0], points[1], 'road')).toBe(result);
  expect(router.cached(points[0], points[1], 'road')?.points).toEqual(result.points);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('keeps GSI, straight, fallback and GSI-requested BRouter rescue surfaces unknown', async () => {
  const marked = points.slice(0, 2).map(p => ({ ...p, surface: 'paved' as const }));
  const router = testRouter(vi.fn(async () => surfaceResponse()));
  expect((await router.segment(marked[0], marked[1], 'mtb', 'straight')).points.every(p => !p.surface)).toBe(true);
  vi.mocked(GsiRouter.prototype.route).mockResolvedValueOnce({ points: marked, fallback: false });
  expect((await router.segment(marked[0], marked[1], 'mtb', 'gsi')).points.every(p => !p.surface)).toBe(true);
  expect((await router.segment(marked[0], marked[1], 'road', 'gsi')).points.every(p => !p.surface)).toBe(true);
  expect((await testRouter(vi.fn(async () => new Response('', { status: 400 }))).segment(marked[0], marked[1], 'road')).points.every(p => !p.surface)).toBe(true);
});
const mixedState = (): RouteState => ({ name: 'mixed', points: points.slice(0, 4), profile: 'gravel', legProfiles: ['mtb', 'road', 'gravel'], legMode: ['road', 'straight', 'road'], legPrefer: ['main', 'main', 'main'], mode: 'road' as const });
it('reads endpoint highways by WayTags column and preserves absent endpoints', async () => {
  const messages = [['WayTags', 'Longitude'], ['highway=service surface=asphalt', 135000000], ['highway=primary', 135000000], ['surface=gravel highway=track', 135000000]];
  expect(endpointHighways(messages)).toEqual({ startHighway: 'service', endHighway: 'track' });
  expect(endpointHighways([messages[0], ['surface=asphalt'], messages[2]])).toEqual({ startHighway: undefined, endHighway: 'primary' });
  expect(endpointHighways([messages[0], messages[1], null])).toEqual({ startHighway: 'service', endHighway: undefined });
  for (const invalid of [null, [], [['WayTags']], [['Other'], ['highway=trunk']], [['WayTags'], [123]]]) {
    expect(endpointHighways(invalid).startHighway).toBeUndefined();
  }
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: [[135, 35], [135, 35.01]] }, properties: { messages } }] })));
  const router = testRouter(fetcher);
  const segment = await router.segment(points[0], points[1], 'road');
  expect(segment).toMatchObject({ startHighway: 'service', endHighway: 'track' });
  expect(router.cached(points[0], points[1], 'road')).toBe(segment);
});
it.each(['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'track', 'path'])('sets both eligible neighbours to side for %s', highway => {
  const state: RouteState = { ...mixedState(), legProfiles: ['road', 'gravel', 'road'], legMode: ['road', 'road', 'road'] };
  const segments: Segment[] = [
    { points: [], fallback: false, startHighway: 'primary', endHighway: highway },
    { points: [], fallback: false, startHighway: highway, endHighway: 'trunk' },
  ];
  const preferred = autoPreferWaypoint(state, 1, segments);
  expect(preferred.legPrefer).toEqual(['side', 'side', 'main']);
  expect(autoPreferWaypoint(preferred, 1, segments)).toBe(preferred);
  expect(autoPreferWaypoint(state, 0, segments)).toBe(state); // first, not last row
});
it.each(['trunk', 'primary', 'secondary', 'trunk_link', 'primary_link', 'secondary_link'])('restores main for %s and uses incoming end tags', highway => {
  const state: RouteState = { ...mixedState(), legProfiles: ['road', 'gravel', 'road'], legMode: ['road', 'road', 'road'], legPrefer: ['side', 'side', 'side'] };
  const segments: Segment[] = [
    { points: [], fallback: false, startHighway: 'track', endHighway: highway },
    { points: [], fallback: false, startHighway: highway, endHighway: 'track' },
    { points: [], fallback: false, startHighway: 'track', endHighway: highway },
  ];
  expect(autoPreferWaypoint(state, 1, segments).legPrefer).toEqual(['main', 'main', 'side']);
  expect(autoPreferWaypoint(state, 3, segments).legPrefer).toEqual(['side', 'side', 'main']);
});
it('leaves unsupported, unknown and failed legs unchanged and resolves conflicting endpoint tags toward side', () => {
  const state = mixedState();
  const side: Segment = { points: [], fallback: false, startHighway: 'track', endHighway: 'track' };
  expect(autoPreferWaypoint(state, 1, [side, side, side])).toBe(state); // MTB + straight
  expect(autoPreferWaypoint({ ...state, legMode: ['road', 'gsi', 'road'] }, 1, [side, side, side]).legPrefer).toEqual(state.legPrefer);
  for (const segment of [{ ...side, fallback: true }, { ...side, gsi: true }, { ...side, brouterRescue: true }, { points: [], fallback: false }]) {
    expect(autoPreferWaypoint(state, 3, [side, side, segment])).toBe(state);
  }
  expect(autoPreferWaypoint({ ...state, importedTrack: points }, 3, [side, side, side]).legPrefer).toEqual(state.legPrefer);
  const supported: RouteState = { ...state, legProfiles: ['road', 'gravel', 'road'], legMode: ['road', 'road', 'road'] };
  expect(autoPreferWaypoint(supported, 1, [{ ...side, endHighway: 'primary' }, side, side]).legPrefer).toEqual(['side', 'side', 'main']);
});
it('inherits preferences on split/merge, defaults appended legs and preserves preferences on redraw', () => {
  const state: RouteState = { ...mixedState(), legPrefer: ['side', 'main', 'side'] };
  expect(insertWaypoint(state, 1, points[4]).legPrefer).toEqual(['side', 'side', 'main', 'side']);
  expect(insertWaypoint(state, 0, points[4]).legPrefer).toEqual(['side', 'side', 'main', 'side']);
  expect(insertWaypoint(state, 4, points[4]).legPrefer).toEqual(['side', 'main', 'side', 'main']);
  expect(removeWaypoint(state, 1).legPrefer).toEqual(['side', 'side']);
  expect(removeWaypoint(state, 2).legPrefer).toEqual(['side', 'main']);
  expect(removeWaypoint(state, 0).legPrefer).toEqual(['main', 'side']);
  expect(removeWaypoint(state, 3).legPrefer).toEqual(['side', 'main']);
  expect(reprofile(state).legPrefer).toEqual(state.legPrefer);
  const history = new History(state);
  history.set(preferLeg(state, 2, 'main')); expect(history.value.legPrefer).toEqual(['side', 'main', 'main']);
  history.undo(); expect(history.value).toEqual(state); expect(history.canUndo).toBe(false);
  expect(preferLeg(state, 0, 'main')).toBe(state); // MTB
  expect(preferLeg(state, 1, 'side')).toBe(state); // straight
  expect(preferLeg({ ...state, legMode: ['road', 'straight', 'gsi'] }, 2, 'main').legPrefer).toEqual(state.legPrefer);
});
it.each(['road', 'gravel'] as const)('routes %s side legs separately from main, including pending requests and warnings', async profile => {
  const registry = new ProfileRegistry();
  const id = vi.spyOn(registry, 'id').mockImplementation(async key => key.endsWith('-side') ? 'custom_2' : 'custom_1');
  const fetcher = vi.fn(async () => response()), router = new Router(fetcher, registry);
  const [main, side, sameSide] = await Promise.all([
    router.segment(points[0], points[1], profile),
    router.segment(points[0], points[1], profile, 'road', () => true, 'side'),
    router.segment(points[0], points[1], profile, 'road', () => true, 'side'),
  ]);
  expect(id.mock.calls.map(([key]) => key)).toEqual([`${profile}-jp`, `${profile}-jp-side`]);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(sameSide).toBe(side);
  expect(router.cached(points[0], points[1], profile, 'road', 'side')).toBe(side);
  expect(router.cached(points[0], points[1], profile)).toBe(main);
  expect(routingWarnings([side], profile, ['side'])).toEqual([]);
  expect(segmentKey(points[0], points[1], profile, 'road', 'side')).not.toBe(segmentKey(points[0], points[1], profile));
  const route = await router.route(points.slice(0, 2), profile, () => true, undefined, ['road'], ['side']);
  expect(route[0]).toBe(side); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not select side profiles for MTB, GSI rescue or straight legs', async () => {
  const registry = new ProfileRegistry(), id = vi.spyOn(registry, 'id').mockResolvedValue('custom_1');
  const router = new Router(vi.fn(async () => response()), registry);
  await router.segment(points[0], points[1], 'mtb', 'road', () => true, 'side');
  await router.segment(points[0], points[1], 'gravel', 'gsi', () => true, 'side');
  await router.segment(points[0], points[1], 'road', 'straight', () => true, 'side');
  expect(id.mock.calls.map(([key]) => key)).toEqual(['mtb-jp', 'gravel-jp']);
});
it('selects profile defaults without changing existing legs and remembers manual modes per profile', () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  const initial = mixedState();
  let state = selectProfile(initial, 'mtb');
  expect(state.mode).toBe('gsi');
  expect(state.legMode).toEqual(initial.legMode); expect(state.legProfiles).toEqual(initial.legProfiles);
  state = selectMode(state, 'straight');
  state = selectProfile(state, 'road'); expect(state.mode).toBe('road');
  state = selectMode(state, 'gsi');
  state = selectProfile(state, 'gravel'); expect(state.mode).toBe('road');
  state = selectProfile(state, 'mtb'); expect(state.mode).toBe('straight');
  expect(defaultLegMode('road')).toBe('gsi');
  expect(insertWaypoint(state, state.points.length, points[4]).legMode.at(-1)).toBe('straight');
  expect(state.legMode).toEqual(initial.legMode);
});
it.each(['broken', null])('ignores invalid saved mode %s', saved => {
  vi.stubGlobal('localStorage', { getItem: () => saved });
  expect(defaultLegMode('mtb')).toBe('gsi'); expect(defaultLegMode('road')).toBe('road');
});
it('works when preference reads and writes throw', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } });
  expect(defaultLegMode('mtb')).toBe('gsi');
  expect(selectMode(mixedState(), 'gsi').mode).toBe('gsi');
});
it.each(['区間が長すぎます', '近くに道がありません', '道がつながりません'])('falls back from GSI (%s) to MTB and caches its warning', async error => {
  const gsi = vi.mocked(GsiRouter.prototype.route).mockRejectedValue(new Error(error));
  const fetcher = vi.fn(async () => { expect(gsi).toHaveBeenCalledOnce(); return response(); });
  const router = testRouter(fetcher);
  const result = await router.segment(points[0], points[1], 'mtb', 'gsi');
  expect(result).toMatchObject({ fallback: false, brouterRescue: true, profileUsed: 'mtb-jp' });
  expect(routingWarnings([result], 'mtb')).toContain('地理院の道で引けないため mtb-jp で計算しました');
  expect(await router.segment(points[0], points[1], 'mtb', 'gsi')).toBe(result);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(router.cached(points[0], points[1], 'road', 'gsi')).toBeUndefined();
});
it.each([true, false])('tries GSI then MTB then trekking before straight (trekking success=%s)', async success => {
  const order: string[] = [];
  vi.mocked(GsiRouter.prototype.route).mockImplementation(async () => { order.push('gsi'); throw new Error('no path'); });
  const router = testRouter(vi.fn(async url => {
    const profile = new URL(String(url)).searchParams.get('profile')!; order.push(profile);
    return success && profile === 'custom_2' ? response() : new Response('', { status: 400 });
  }));
  const result = await router.segment(points[0], points[1], 'mtb', 'gsi');
  expect(order).toEqual(['gsi', 'custom_1', 'custom_2']);
  expect(result.fallback).toBe(!success);
  if (success) expect(routingWarnings([result], 'mtb')).toContain('地理院の道で引けないため trekking-jp で計算しました');
  else expect(result.points).toEqual(points.slice(0, 2));
});
it.each([['road', 'custom_4'], ['gravel', 'custom_3']] as const)('uses the selected %s BRouter after GSI failure', async (profile, id) => {
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => response()), router = testRouter(fetcher);
  expect((await router.segment(points[0], points[1], profile, 'gsi')).brouterRescue).toBe(true);
  expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get('profile')).toBe(id);
});
it.each([[1500, 500, false], [1500.01, 500, true], [2500, 1000, false], [2500.01, 1000, true]])('detour boundary L=%s D=%s', (length, direct, expected) => {
  expect(isDetour(length, direct)).toBe(expected);
});
const detourSegment = (): Segment => ({ points: [points[0], { lat: 35.02, lng: 135 }, points[1]], fallback: false, profileUsed: 'mtb-jp' });
it.each([0.5999, 0.6, 0.6001])('suggests only below 60 percent (%s)', async ratio => {
  const segment = detourSegment();
  const alternative = points.slice(0, 2);
  // Fix measured lengths to check strict equality without geodesic rounding.
  vi.spyOn(geo, 'routeLength').mockReturnValueOnce(4500).mockReturnValueOnce(4500 * ratio);
  vi.mocked(GsiRouter.prototype.route).mockResolvedValue({ points: alternative, fallback: false });
  const suggestion = await testRouter(vi.fn()).detour(points[0], points[1], 'mtb', 'road', segment);
  expect(Boolean(suggestion)).toBe(ratio < 0.6);
});
it.each([
  ['straight', {}], ['gsi', {}], ['road', { fallback: true }], ['road', { gsi: true }],
  ['road', { gsiRescue: true, gsi: true }], ['road', { profileUsed: undefined }], ['road', { points: points.slice(0, 2) }],
] as [LegMode, Partial<Segment>][])('compares only successful BRouter detours: %s %s', async (mode, overrides) => {
  expect(await testRouter(vi.fn()).detour(points[0], points[1], 'mtb', mode, { ...detourSegment(), ...overrides })).toBeUndefined();
  expect(GsiRouter.prototype.route).not.toHaveBeenCalled();
});
it('silently ignores GSI failure and does not alter the OSM cache', async () => {
  const router = testRouter(vi.fn(async () => response()));
  const original = await router.segment(points[0], points[1], 'mtb');
  expect(await router.detour(points[0], points[1], 'mtb', 'road', detourSegment())).toBeUndefined();
  expect(router.cached(points[0], points[1], 'mtb')).toBe(original);
});
it('serializes background comparisons and drops obsolete queued work and results', async () => {
  let resolve!: (value: Segment) => void, current = true;
  vi.mocked(GsiRouter.prototype.route).mockImplementation(() => new Promise(done => { resolve = done; }));
  const router = testRouter(vi.fn());
  const first = router.detour(points[0], points[1], 'mtb', 'road', detourSegment(), () => current);
  const second = router.detour(points[1], points[2], 'mtb', 'road', detourSegment(), () => current);
  await vi.waitFor(() => expect(GsiRouter.prototype.route).toHaveBeenCalledTimes(1));
  current = false; resolve({ points: points.slice(0, 2), fallback: false });
  expect(await Promise.all([first, second])).toEqual([undefined, undefined]);
  expect(GsiRouter.prototype.route).toHaveBeenCalledTimes(1);
});
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
  const empty = { ...state, points: [], legProfiles: [], legMode: [], legPrefer: [] };
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
  expect(history.value.legMode).toEqual(['road', 'road', 'road']);
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
  expect(segmentKey(points[0], points[1], 'road')).toBe('road:road:main:135.000000,35.000000|135.000000,35.010000');
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
  const state = { ...mixedState(), mode: 'straight' as const };
  expect(insertWaypoint(state, 4, points[4]).legMode).toEqual(['road', 'straight', 'road', 'straight']);
  expect(insertWaypoint(state, 2, points[4]).legMode).toEqual(['road', 'straight', 'straight', 'road']);
  expect(insertWaypoint(state, 1, points[4]).legMode).toEqual(['road', 'road', 'straight', 'road']);
  expect(insertWaypoint(state, 0, points[4]).legMode).toEqual(['road', 'road', 'straight', 'road']);
  expect(removeWaypoint(state, 1).legMode).toEqual(['road', 'road']);
  expect(removeWaypoint(state, 2).legMode).toEqual(['road', 'straight']);
  expect(removeWaypoint(state, 0).legMode).toEqual(['straight', 'road']);
  expect(removeWaypoint(state, 3).legMode).toEqual(['road', 'straight']);
  const history = new History(state);
  history.set({ ...state, points: state.points.map((p, i) => i === 1 ? points[4] : p) });
  expect(history.value.legMode).toEqual(['road', 'straight', 'road']); history.undo(); expect(history.value).toEqual(state);
  const first = insertWaypoint({ ...state, points: [], legProfiles: [], legMode: [] }, 0, points[0]);
  expect(first.legMode).toEqual([]);
  expect(insertWaypoint(first, 1, points[1]).legMode).toEqual(['straight']);
  expect(removeWaypoint(first, 0).legMode).toEqual([]);
  expect(state.legMode).toEqual(['road', 'straight', 'road']);
});
it.each([0, undefined])('redraws both settings and restores both with one undo (%s)', index => {
  const state = { ...mixedState(), mode: 'straight' as const }, history = new History(state);
  history.set(reprofile(state, index));
  expect(history.value.legMode).toEqual(index === 0 ? ['straight', 'straight', 'road'] : ['straight', 'straight', 'straight']);
  expect(history.value.legProfiles).toEqual(index === 0 ? ['gravel', 'road', 'gravel'] : ['gravel', 'gravel', 'gravel']);
  history.undo(); expect(history.value).toEqual(state); expect(history.canUndo).toBe(false);
});
it('never requests straight legs, including when a road result is cached, and keeps mixed results ordered', async () => {
  const fetcher = vi.fn(async () => response()), router = testRouter(fetcher), state = mixedState();
  const run = (follow: LegMode[]) => router.route(state.points, state.legProfiles, undefined, undefined, follow);
  const straight = await run(['straight', 'straight', 'straight']); expect(fetcher).not.toHaveBeenCalled();
  expect(straight.map(s => s.points)).toEqual(state.points.slice(1).map((p, i) => [state.points[i], p]));
  const mixed = await run(state.legMode); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(mixed[1]).toEqual({ points: [points[1], points[2]], fallback: false });
  expect(routingWarnings(mixed, state.legProfiles)).toEqual([]);
  expect(await run(['straight', 'straight', 'straight'])).toEqual(straight); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(router.cached(points[0], points[1], 'mtb', 'straight')).toBeUndefined();
  expect(router.cached(points[0], points[1], 'mtb', 'road')).toBeDefined();
  expect(segmentKey(points[0], points[1], 'mtb', 'straight')).not.toBe(segmentKey(points[0], points[1], 'mtb', 'road'));
  await expect(run([])).rejects.toThrow();
});

it('routes GSI without BRouter and caches by profile and mode', async () => {
  const fetcher = vi.fn(), router = testRouter(fetcher);
  const shape = [points[0], { lat: 35.004, lng: 135.002 }, points[1]];
  const gsi = vi.mocked(GsiRouter.prototype.route).mockResolvedValue({ points: shape, fallback: false });
  const result = await router.segment(points[0], points[1], 'mtb', 'gsi');
  expect(result).toEqual({ points: shape, fallback: false, gsi: true });
  expect(await router.segment(points[0], points[1], 'mtb', 'gsi')).toBe(result);
  expect(router.cached(points[0], points[1], 'road', 'gsi')).toBeUndefined();
  expect(router.cached(points[0], points[1], 'mtb', 'road')).toBeUndefined();
  expect(gsi).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  expect(routingWarnings([result], 'mtb')).toEqual([]);
});
it.each(['gsi', 'road'] as const)('connects the real GSI router to %s using synthetic tiles only', async mode => {
  vi.mocked(GsiRouter.prototype.route).mockRestore();
  const shape = [points[0], { lat: 35.004, lng: 135.002 }, points[1]];
  const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('/experimental_rdcl/')
    ? new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { ftCode: '2721', motorway: 0 }, geometry: { type: 'LineString', coordinates: shape.map(p => [p.lng, p.lat]) } }] }))
    : new Response('no route', { status: 400 }));
  const router = testRouter(fetcher), result = await router.segment(points[0], points[1], 'mtb', mode);
  expect(result).toMatchObject({ fallback: false, gsi: true });
  expect(result.points).toContainEqual(shape[1]);
  const brouterCalls = fetcher.mock.calls.filter(([url]) => String(url).includes('brouter.de'));
  expect(brouterCalls).toHaveLength(mode === 'gsi' ? 0 : 2);
  if (mode === 'road') expect(result.gsiRescue).toBe(true);
});
it('rescues only after both MTB profiles fail, retains road mode and caches the rescue warning', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 400 })), router = testRouter(fetcher);
  const gsi = vi.mocked(GsiRouter.prototype.route).mockImplementation(async (a, b) => {
    expect(fetcher).toHaveBeenCalledTimes(2);
    return { points: [a, { lat: 35.005, lng: 135.002 }, b], fallback: false };
  });
  const state: RouteState = { ...mixedState(), points: points.slice(0, 2), legProfiles: ['mtb'], legMode: ['road'] };
  const run = () => router.route(state.points, state.legProfiles, undefined, undefined, state.legMode);
  const result = await run();
  expect(result[0]).toMatchObject({ gsi: true, gsiRescue: true, fallback: false });
  expect(state.legMode).toEqual(['road']);
  expect(routingWarnings(await run(), state.legProfiles)).toEqual(['OSMで経路が見つからないため地理院の道で計算しました']);
  expect(gsi).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('returns a straight line with a GSI error and retries failed GSI legs', async () => {
  const fetcher = vi.fn(), router = testRouter(fetcher);
  const gsi = vi.mocked(GsiRouter.prototype.route).mockRejectedValue(new Error('地理院の道がつながっていません'));
  const result = await router.segment(points[0], points[1], 'road', 'gsi');
  expect(result).toMatchObject({ points: points.slice(0, 2), fallback: true });
  expect(routingWarnings([result], 'road')).toContain('地理院の道がつながっていません');
  expect(router.cached(points[0], points[1], 'road', 'gsi')).toBeUndefined();
  await router.segment(points[0], points[1], 'road', 'gsi');
  expect(gsi).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('shares GSI work while retaining live consumers and drops cancelled results', async () => {
  let finish!: () => void, active!: () => boolean;
  const gsi = vi.mocked(GsiRouter.prototype.route).mockImplementation((a, b, current) => {
    active = current!;
    return new Promise(resolve => { finish = () => resolve({ points: [a, b], fallback: false }); });
  });
  const router = testRouter(vi.fn()), resolved = vi.fn();
  let current = true;
  const old = router.route(points.slice(0, 2), 'road', () => current, resolved, ['gsi']);
  await vi.waitFor(() => expect(gsi).toHaveBeenCalledOnce());
  current = false;
  const live = router.route(points.slice(0, 2), 'road', undefined, undefined, ['gsi']);
  expect(active()).toBe(true); finish();
  await Promise.all([old, live]);
  expect(resolved).not.toHaveBeenCalled(); expect(gsi).toHaveBeenCalledOnce();
});
it('absorbs obsolete GSI cancellation without publishing or caching a straight fallback', async () => {
  let reject!: (error: Error) => void, current = true;
  vi.mocked(GsiRouter.prototype.route).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const router = testRouter(vi.fn()), resolved = vi.fn();
  const job = router.route(points.slice(0, 2), 'road', () => current, resolved, ['gsi']);
  await vi.waitFor(() => expect(reject).toBeDefined());
  current = false; reject(new DOMException('cancelled', 'AbortError'));
  await expect(job).resolves.toEqual([]);
  expect(resolved).not.toHaveBeenCalled();
  expect(router.cached(points[0], points[1], 'road', 'gsi')).toBeUndefined();
});
it('inherits all three modes on append, split, prepend and deletion and restores redraws with Undo', () => {
  const state: RouteState = { ...mixedState(), mode: 'gsi', legMode: ['road', 'gsi', 'straight'] };
  expect(insertWaypoint(state, 4, points[4]).legMode).toEqual(['road', 'gsi', 'straight', 'gsi']);
  expect(insertWaypoint(state, 2, points[4]).legMode).toEqual(['road', 'gsi', 'gsi', 'straight']);
  expect(insertWaypoint(state, 0, points[4]).legMode).toEqual(['road', 'road', 'gsi', 'straight']);
  expect(removeWaypoint(state, 2).legMode).toEqual(['road', 'gsi']);
  expect(removeWaypoint(state, 1).legMode).toEqual(['road', 'straight']);
  const history = new History(state);
  history.set(reprofile(state, 0)); expect(history.value.legMode).toEqual(['gsi', 'gsi', 'straight']);
  history.undo(); expect(history.value).toEqual(state);
  history.set(reprofile(state)); expect(history.value.legMode).toEqual(['gsi', 'gsi', 'gsi']);
  history.undo(); expect(history.value).toEqual(state);
});
