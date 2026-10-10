import { CONFIG } from './config';
import { afterEach, expect, it, vi } from 'vitest';
import { GsiRouter } from './gsi-router';
import { distance, routeLength } from './geo';
import type { Point } from './types';

const R = 6371008.8, RAD = Math.PI / 180;
const point = (east: number, north = 0): Point => ({
  lat: Math.round((35 + north / (R * RAD)) * 1e6) / 1e6,
  lng: Math.round((139 + east / (R * RAD * Math.cos(35 * RAD))) * 1e6) / 1e6,
});
const coordinates = (points: Point[]) => points.map(p => [p.lng, p.lat]);
function line(points: Point[], properties: Record<string, unknown> = { ftCode: '2701', motorway: 0 }) {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coordinates(points) } };
}
const collection = (features: unknown[] = []) => ({ type: 'FeatureCollection', features });
const response = (features: unknown[] = []) => new Response(JSON.stringify(collection(features)), { headers: { 'Content-Type': 'application/octet-stream' } });
function fixture(features: unknown[]) {
  let served = false;
  const fetcher = vi.fn(async () => {
    const result = response(served ? [] : features); served = true; return result;
  });
  return { router: new GsiRouter(fetcher), fetcher };
}
function expectNear(actual: Point, expected: Point) { expect(distance(actual, expected)).toBeLessThan(0.15); }
function tileId(url: RequestInfo | URL) {
  const match = String(url).match(/\/16\/(\d+)\/(\d+)\.geojson$/)!;
  return { x: Number(match[1]), y: Number(match[2]) };
}
function tileCenter(x: number, y: number): Point {
  return { lng: (x + 0.5) / 65536 * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 65536))) / RAD };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('projects both endpoints, retains intermediate geometry and returns a non-fallback Segment', async () => {
  const a = point(50, 30), b = point(350, -20), middle = point(200);
  const { router } = fixture([line([point(0), middle, point(400)])]);
  const segment = await router.route(a, b, () => true);
  expect(segment.fallback).toBe(false);
  expect(segment.points).toHaveLength(5);
  expect(segment.points[0]).toBe(a); expect(segment.points.at(-1)).toBe(b);
  expectNear(segment.points[1], point(50)); expectNear(segment.points[3], point(350));
  expect(segment.points[2]).toEqual(middle);
  expect(routeLength(segment.points)).toBeCloseTo(350, 0);
});

it('connects lines from separate tiles at their shared tile boundary', async () => {
  const x = Math.floor((139 + 180) / 360 * 65536), boundary = (x + 1) / 65536 * 360 - 180;
  const join = { lat: 35, lng: boundary }, a = { lat: 35, lng: boundary - 0.002 }, b = { lat: 35, lng: boundary + 0.002 };
  const y = Math.floor((1 - Math.asinh(Math.tan(35 * RAD)) / Math.PI) / 2 * 65536);
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    const tile = tileId(url);
    return response(tile.y !== y ? [] : tile.x === x ? [line([a, join])] : tile.x === x + 1 ? [line([join, b])] : []);
  });
  const result = await new GsiRouter(fetcher).route(a, b);
  expect(result.points.some(p => distance(p, join) < 0.1)).toBe(true);
  expect(routeLength(result.points)).toBeCloseTo(distance(a, b), 0);
});

it('rounds all vertices to 1e-6 degrees, including an interior junction', async () => {
  const a = point(0), junction = point(200), b = point(200, 200);
  const almost = { lat: junction.lat + 0.0000002, lng: junction.lng - 0.0000002 };
  const { router } = fixture([line([a, junction, point(400)]), line([almost, b])]);
  const result = await router.route(a, b);
  expect(result.points).toContainEqual(junction);
  expect(routeLength(result.points)).toBeCloseTo(400, 0);
});

it.each([1.5, 2.5])('merges only endpoints within 2 m (gap %s m)', async gap => {
  const { router } = fixture([line([point(0), point(200)]), line([point(200 + gap), point(400)])]);
  const route = await router.route(point(0), point(400));
  expect(routeLength(route.points)).toBeCloseTo(400, 0);
  expect(route.bridged).toBe(gap < 2 ? undefined : true);
  if (gap < 2) expect(route.points).not.toContainEqual(point(200 + gap));
  else expect(route.points).toContainEqual(point(200 + gap));
});

it('bridges rather than merges a nearby endpoint and an interior vertex', async () => {
  const { router } = fixture([
    line([point(0), point(200), point(400)]),
    line([point(200, 1.5), point(200, 200)]),
  ]);
  const result = await router.route(point(0), point(200, 200));
  expect(result.bridged).toBe(true);
  expect(result.points).toContainEqual(point(200));
  expect(result.points).toContainEqual(point(200, 1.5));
});

it.each([16, 29.8, 30.2, 31])('bridges separate components only within 30 m (gap %s m)', async gap => {
  expect(CONFIG.gsi.bridgeM).toBe(30);
  const left = point(200), right = point(200 + gap);
  const { router } = fixture([line([point(0), left]), line([right, point(400)])]);
  if (gap > 30) {
    await expect(router.route(point(0), point(400))).rejects.toThrow('地理院の道がつながっていません');
  } else {
    const result = await router.route(point(0), point(400));
    expect(result.bridged).toBe(true);
    expect(result.points).toContainEqual(left);
    expect(result.points).toContainEqual(right);
    expect(routeLength(result.points)).toBeCloseTo(400, 0); // Geometry is not multiplied by the penalty.
    expect((await router.route(point(400), point(0))).bridged).toBe(true);
  }
});

it('does not create a shortcut inside an existing component', async () => {
  const a = point(0), b = point(16), bend1 = point(0, 100), bend2 = point(16, 100);
  const { router } = fixture([line([a, bend1, bend2, b])]);
  const result = await router.route(a, b);
  expect(result.bridged).toBeUndefined();
  expect(result.points).toContainEqual(bend1);
  expect(result.points).toContainEqual(bend2);
  expect(routeLength(result.points)).toBeCloseTo(216, 0);
});

it('adds only the closest bridge per original component pair', async () => {
  // The closer pair comes last in the input, so keeping the first candidate is wrong.
  const a = point(100), b = point(100, 20), left = point(0), right = point(0, 16);
  const { router } = fixture([line([a, left]), line([b, right])]);
  const result = await router.route(a, b);
  expect(result.bridged).toBe(true);
  expect(result.points).toContainEqual(left);
  expect(result.points).toContainEqual(right);
  expect(routeLength(result.points)).toBeCloseTo(216, 0);
});

it('penalizes bridges by three and prefers a cheaper normal road', async () => {
  expect(CONFIG.gsi.bridgePenalty).toBe(3);
  const a = point(0), b = point(50), bend1 = point(0, -40), bend2 = point(50, -40);
  const { router } = fixture([
    line([a, bend1, bend2, b]),
    line([point(0, 16), point(10, 16)]),
    line([point(38, 16), point(50, 16)]),
  ]);
  const result = await router.route(a, b);
  expect(result.bridged).toBeUndefined();
  expect(routeLength(result.points)).toBeCloseTo(130, 0);
  // Control: the three bridges form a physically shorter route, but cost more at x3.
  const penalty = CONFIG.gsi.bridgePenalty;
  try {
    CONFIG.gsi.bridgePenalty = 1;
    const unpenalized = await router.route(a, b);
    expect(unpenalized.bridged).toBe(true);
    expect(routeLength(unpenalized.points)).toBeCloseTo(82, 0);
  } finally { CONFIG.gsi.bridgePenalty = penalty; }
});

it.each([[16, 0], [0, 16], [16, 16], [-16, 16]])('finds bridges across grid boundaries (offset %s, %s)', async (east, north) => {
  // Around (0, 0), Cartesian y/z cells change sign; diagonal neighbours are required.
  const local = (x: number, y: number): Point => ({
    lat: Math.round(y / (R * RAD) * 1e6) / 1e6 + 0,
    lng: Math.round(x / (R * RAD) * 1e6) / 1e6 + 0,
  });
  const a = local(-east / 2, -north / 2), b = local(east / 2, north / 2);
  const start = local(-east * 5, -north * 5), end = local(east * 5, north * 5);
  const { router } = fixture([line([start, a]), line([b, end])]);
  const result = await router.route(start, end);
  expect(result.bridged).toBe(true);
  expect(result.points).toContainEqual(a);
  expect(result.points).toContainEqual(b);
});

it('includes a bridge exactly at the configured distance limit', async () => {
  const a = point(0), b = point(16);
  const { router } = fixture([line([point(-100), a]), line([b, point(100)])]);
  const limit = CONFIG.gsi.bridgeM;
  try {
    CONFIG.gsi.bridgeM = distance(a, b);
    expect((await router.route(point(-100), point(100))).bridged).toBe(true);
    CONFIG.gsi.bridgeM -= 0.001;
    await expect(router.route(point(-100), point(100))).rejects.toThrow('地理院の道がつながっていません');
  } finally { CONFIG.gsi.bridgeM = limit; }
});

it('snaps a waypoint in a gap to a real road rather than the synthetic bridge', async () => {
  const a = point(0), b = point(16);
  const { router } = fixture([line([point(-100), a]), line([b, point(100)])]);
  const result = await router.route(point(7), point(100));
  expect(result.bridged).toBe(true);
  expect(result.points[1]).toEqual(a);
  expect(result.points).toContainEqual(b);
});

it.each(['2701', '2703', '2704', '2711', '2721'])('uses road code %s regardless of text access attributes', async ftCode => {
  const { router } = fixture([line([point(0), point(200)], { ftCode, motorway: 9, type: '\uFFFD', rdCtg: '\uFFFD', rnkWidth: '\uFFFD', access: 'no' })]);
  expect((await router.route(point(0), point(200))).fallback).toBe(false);
});

it('excludes motorway=1 even when it would provide the shortest path', async () => {
  const a = point(0), b = point(400), bend1 = point(0, 200), bend2 = point(400, 200);
  const { router } = fixture([line([a, b], { ftCode: '2701', motorway: 1 }), line([a, bend1, bend2, b])]);
  const result = await router.route(a, b);
  expect(result.points).toContainEqual(bend1); expect(result.points).toContainEqual(bend2);
  expect(routeLength(result.points)).toBeCloseTo(800, 0);
});

it('reports no nearby road when only motorways exist', async () => {
  const { router } = fixture([line([point(0), point(200)], { motorway: 1 })]);
  await expect(router.route(point(0), point(200))).rejects.toThrow('近くに地理院の道がありません');
});

it('supports MultiLineString with independent component endpoints', async () => {
  const { router } = fixture([{ type: 'Feature', properties: { ftCode: 2721, motorway: 0 }, geometry: {
    type: 'MultiLineString', coordinates: [coordinates([point(0), point(200)]), coordinates([point(201.5), point(400)])],
  } }]);
  expect(routeLength((await router.route(point(0), point(400))).points)).toBeCloseTo(400, 0);
});

it.each([[50, 350], [350, 50], [200, 200], [0, 400]])('splits one edge at both projections (%s to %s m)', async (from, to) => {
  const { router } = fixture([line([point(0), point(400)])]);
  const a = point(from, 30), b = point(to, 30);
  const result = await router.route(a, b);
  expectNear(result.points[1], point(from)); expectNear(result.points.at(-2)!, point(to));
  expect(routeLength(result.points)).toBeCloseTo(Math.abs(to - from) + 60, 0);
});

it.each([299, 301])('enforces the 300 m snapping limit (%s m)', async offset => {
  const { router } = fixture([line([point(0), point(200)])]);
  const route = router.route(point(50, offset), point(150, offset));
  if (offset < 300) expect((await route).fallback).toBe(false);
  else await expect(route).rejects.toThrow('近くに地理院の道がありません');
});

it('checks the end point snapping limit independently', async () => {
  const { router } = fixture([line([point(0), point(200)])]);
  await expect(router.route(point(50), point(150, 301))).rejects.toThrow('近くに地理院の道がありません');
});

it('reports disconnected roads even when both endpoints snap', async () => {
  const { router } = fixture([line([point(0), point(100)]), line([point(300), point(400)])]);
  await expect(router.route(point(0), point(400))).rejects.toThrow('地理院の道がつながっていません');
});

it('chooses the shortest path through a branching graph, independent of feature order', async () => {
  const a = point(0), b = point(400), top = point(200, 300), bottom = point(200, -100);
  const { router } = fixture([line([a, top, b]), line([a, bottom, b])]);
  const result = await router.route(a, b);
  expect(result.points).toContainEqual(bottom); expect(result.points).not.toContainEqual(top);
  expect(routeLength(result.points)).toBeCloseTo(2 * Math.hypot(200, 100), 0);
});

it('rejects an area above 300 tiles before fetching', async () => {
  const fetcher = vi.fn(async () => response());
  await expect(new GsiRouter(fetcher).route(point(0), point(10000, 10000)))
    .rejects.toThrow('区間が長すぎます。途中に経由点を追加してください');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([200, 2000, 4600])('covers the entire padded bbox at zoom 16 (%s m leg)', async length => {
  const a = point(0), b = point(length), margin = Math.max(400, distance(a, b) * 0.3);
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => response([line([a, b])]));
  await new GsiRouter(fetcher).route(a, b);
  const tiles = fetcher.mock.calls.map(([url]) => tileId(url));
  const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  expect(tiles).toHaveLength((maxX - minX + 1) * (maxY - minY + 1));
  expect(tiles.length).toBeLessThanOrEqual(CONFIG.gsi.tileLimit);
  const west = minX / 65536 * 360 - 180, east = (maxX + 1) / 65536 * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * minY / 65536))) / RAD;
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (maxY + 1) / 65536))) / RAD;
  expect(distance(a, { lat: a.lat, lng: west })).toBeGreaterThanOrEqual(margin);
  expect(distance(b, { lat: b.lat, lng: east })).toBeGreaterThanOrEqual(margin);
  expect(distance(a, { lat: north, lng: a.lng })).toBeGreaterThanOrEqual(margin);
  expect(distance(a, { lat: south, lng: a.lng })).toBeGreaterThanOrEqual(margin);
  for (const [url] of fetcher.mock.calls) expect(String(url)).toMatch(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/experimental_rdcl\/16\/\d+\/\d+\.geojson$/);
});

it('allows a diagonal 4.6km leg requiring more than 120 tiles under the configured 300 limit', async () => {
  expect(CONFIG.gsi.tileLimit).toBe(300);
  const a = point(0), b = point(4600 / Math.SQRT2, 4600 / Math.SQRT2);
  const { router, fetcher } = fixture([line([a, b])]);
  expect((await router.route(a, b)).fallback).toBe(false);
  expect(fetcher.mock.calls.length).toBeGreaterThan(120);
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(CONFIG.gsi.tileLimit);
});

it('caches 404 as an empty tile and can route through the remaining tiles', async () => {
  let first = true;
  const fetcher = vi.fn(async () => {
    if (first) { first = false; return response([line([point(0), point(200)])]); }
    return new Response('not json', { status: 404 });
  });
  const router = new GsiRouter(fetcher);
  const result = await router.route(point(0), point(200)), calls = fetcher.mock.calls.length;
  expect(calls).toBeGreaterThan(1);
  expect(await router.route(point(0), point(200))).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});

it('returns the no-road error when all tiles are 404', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 404 }));
  await expect(new GsiRouter(fetcher).route(point(0), point(200))).rejects.toThrow('近くに地理院の道がありません');
});

it.each(['network', 'http', 'json', 'schema', 'coordinates'])('does not cache a %s failure', async failure => {
  let fail = true;
  const fetcher = vi.fn(async () => {
    if (!fail) return response([line([point(0), point(200)])]);
    if (failure === 'network') throw new Error('offline');
    if (failure === 'http') return new Response('', { status: 503 });
    if (failure === 'json') return new Response('invalid json');
    if (failure === 'schema') return new Response('{}');
    return response([line([{ lat: NaN, lng: 139 }, point(200)])]);
  });
  const router = new GsiRouter(fetcher);
  await expect(router.route(point(0), point(200))).rejects.toThrow();
  const calls = fetcher.mock.calls.length;
  // Let all first-batch workers settle before retrying the same tiles.
  await new Promise(resolve => setTimeout(resolve, 0));
  fail = false;
  expect((await router.route(point(0), point(200))).fallback).toBe(false);
  expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
});

it('enforces a shared limit of six requests and shares in-flight tiles across routes', async () => {
  let active = 0, peak = 0;
  const urls = new Set<string>();
  const fetcher = vi.fn(async (url: RequestInfo | URL) => {
    active++; peak = Math.max(peak, active); urls.add(String(url));
    await new Promise(resolve => setTimeout(resolve, 2));
    active--; return response([line([point(0), point(2000)])]);
  });
  const router = new GsiRouter(fetcher);
  const results = await Promise.all([
    router.route(point(0), point(200)), router.route(point(0), point(200)), router.route(point(1800), point(2000)),
  ]);
  expect(results.every(result => !result.fallback)).toBe(true);
  expect(peak).toBe(6); expect(active).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(urls.size);
});

it('keeps exactly 400 tiles with least-recently-used eviction and refreshes cache hits', async () => {
  let delay = false;
  const fetcher = vi.fn(async () => {
    if (delay) await new Promise(resolve => setTimeout(resolve, 0));
    return new Response('', { status: 404 });
  });
  const router = new GsiRouter(fetcher);
  const visit = async (index: number) => {
    const p = tileCenter(58000 + index * 8, 25958);
    await expect(router.route(p, p)).rejects.toThrow('近くに地理院の道がありません');
  };
  for (let i = 0; i < 44; i++) await visit(i);
  expect(fetcher).toHaveBeenCalledTimes(396); // Each disjoint padded area covers nine tiles.
  await visit(0); expect(fetcher).toHaveBeenCalledTimes(396);
  await visit(44); expect(fetcher).toHaveBeenCalledTimes(405);
  await visit(0); expect(fetcher).toHaveBeenCalledTimes(405); // Recently used tiles survived.
  // Allow all retained tiles to be read before returning cache misses. Immediate
  // replies would evict later tiles in this same area before its workers read them.
  delay = true;
  await visit(1); expect(fetcher).toHaveBeenCalledTimes(410); // Only the five oldest tiles were evicted.
});

it('aborts tile fetches at 15 seconds and retries them on the next route', async () => {
  vi.useFakeTimers();
  let hang = true;
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
    if (!hang) return Promise.resolve(response([line([point(0), point(200)])]));
    const signal = init!.signal!; signals.push(signal);
    return new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const router = new GsiRouter(fetcher);
  const rejected = expect(router.route(point(0), point(200))).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(14999);
  expect(signals).toHaveLength(6); expect(signals.every(signal => !signal.aborted)).toBe(true);
  await vi.advanceTimersByTimeAsync(1); await rejected;
  expect(signals.every(signal => signal.aborted)).toBe(true);
  hang = false;
  expect((await router.route(point(0), point(200))).fallback).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('rejects obsolete work without fetching', async () => {
  const fetcher = vi.fn(async () => response());
  await expect(new GsiRouter(fetcher).route(point(0), point(200), () => false)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('stops obsolete work after the running batch without returning stale geometry', async () => {
  let current = true;
  const replies: (() => void)[] = [];
  const fetcher = vi.fn(() => new Promise<Response>(resolve => replies.push(() => resolve(response([line([point(0), point(2000)])])))));
  const router = new GsiRouter(fetcher);
  const rejected = expect(router.route(point(0), point(2000), () => current)).rejects.toMatchObject({ name: 'AbortError' });
  expect(replies).toHaveLength(6);
  current = false; replies.forEach(reply => reply()); await rejected;
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it('lets a current route reuse tile requests started by an obsolete route', async () => {
  let current = true, batch = true;
  const replies: (() => void)[] = [];
  const fetcher = vi.fn(() => batch
    ? new Promise<Response>(resolve => replies.push(() => resolve(response([line([point(0), point(200)])]))))
    : Promise.resolve(response([line([point(0), point(200)])])));
  const router = new GsiRouter(fetcher);
  const rejected = expect(router.route(point(0), point(200), () => current)).rejects.toMatchObject({ name: 'AbortError' });
  const latest = router.route(point(0), point(200));
  expect(fetcher).toHaveBeenCalledTimes(6);
  current = false; batch = false; replies.forEach(reply => reply());
  await rejected; expect((await latest).fallback).toBe(false);
});

it('calls browser fetch without a GsiRouter receiver', async () => {
  vi.stubGlobal('fetch', function(this: unknown) {
    if (this instanceof GsiRouter) throw new Error('Illegal invocation');
    return Promise.resolve(response([line([point(0), point(200)])]));
  });
  expect((await new GsiRouter().route(point(0), point(200))).fallback).toBe(false);
});

it('rejects invalid endpoints before fetching', async () => {
  const fetcher = vi.fn(async () => response());
  await expect(new GsiRouter(fetcher).route({ lat: NaN, lng: 139 }, point(200))).rejects.toThrow('経路の座標が不正です');
  expect(fetcher).not.toHaveBeenCalled();
});
