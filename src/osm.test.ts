import { afterEach, expect, it, vi } from 'vitest';
import { buildOsmQuery, isOverpassBusy, OsmProvider, routeBBox, simplifyRoute, splitOsmResponse, type OsmElement } from './osm';
import { nearestOnRoute } from './geo';

const route = [{ lat: 35.1180, lng: 135.7706 }, { lat: 35.1587, lng: 135.7861 }, { lat: 35.1900, lng: 135.7760 }];
const node = (id: number, tags: Record<string, string>, lng = route[1].lng): OsmElement => ({ type: 'node', id, lat: route[1].lat, lon: lng, tags });
const elements: OsmElement[] = [
  node(1, { mountain_pass: 'yes', name: '花脊峠', ele: '760' }),
  node(2, { shop: 'convenience' }),
  { type: 'way', id: 2, center: { lat: route[1].lat, lon: route[1].lng }, tags: { shop: 'bakery' } },
];
const response = (data = elements) => new Response(JSON.stringify({ elements: data }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('simplifies in metres while retaining endpoints and significant bends', () => {
  expect(simplifyRoute([])).toEqual([]);
  expect(simplifyRoute([route[0]])).toEqual([route[0]]);
  const line = [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135.0001 }, { lat: 35.02, lng: 135 }];
  expect(simplifyRoute(line)).toEqual([line[0], line[2]]);
  line[1].lng = 135.001;
  expect(simplifyRoute(line)).toEqual(line);
  expect(simplifyRoute([route[0], route[0], route[0]])).toEqual([route[0], route[0]]);
  expect(() => simplifyRoute(line, 0)).toThrow();
  expect(() => simplifyRoute([{ lat: NaN, lng: 0 }])).toThrow();
});

it('doubles tolerance to cap a winding route at 400 vertices', () => {
  const winding = Array.from({ length: 901 }, (_, i) => ({ lat: 35 + i * 0.00002, lng: 135 + (i % 2) * 0.001 }));
  const simplified = simplifyRoute(winding);
  expect(simplified.length).toBeLessThanOrEqual(400);
  expect(simplified[0]).toEqual(winding[0]); expect(simplified.at(-1)).toEqual(winding.at(-1));
  // At 30m every zigzag would remain. Raising tolerance permits reduction.
  expect(nearestOnRoute(winding[1], [winding[0], winding[2]]).offset).toBeGreaterThan(30);
});

it('combines the unchanged place bbox selectors with every POI around selector', () => {
  const query = buildOsmQuery(route), bbox = routeBBox(route).join(',');
  expect(query).toContain(`node["mountain_pass"="yes"](${bbox})`);
  expect(query).toContain(`node["natural"="saddle"][name](${bbox})`);
  expect(query).toContain(`node["natural"="peak"][name](${bbox})`);
  expect(query.match(/nwr\(around:300,/g)).toHaveLength(2);
  expect(query.match(/nwr\(around:100,/g)).toHaveLength(2);
  expect(query.match(/nwr\(around:200,/g)).toHaveLength(4);
  expect(query.match(/nwr\(around:500,/g)).toHaveLength(2);
  const line = '35.118,135.7706,35.1587,135.7861,35.19,135.776';
  expect(query).toContain('nwr(around:300,' + line + ')["shop"="convenience"]');
  expect(query).toContain('nwr(around:100,' + line + ')["amenity"="vending_machine"]');
  expect(query).toContain('nwr(around:200,' + line + ')["amenity"="drinking_water"]');
  expect(query).toContain('nwr(around:200,' + line + ')["amenity"="toilets"]');
  expect(query).toContain('nwr(around:500,' + line + ')["name"~"^道の駅"]');
  for (const tag of ['convenience', 'supermarket|general|grocery|greengrocer|bakery|deli', 'vending_machine', 'drinks', 'drinking_water', 'water_tap', 'spring', 'toilets', '^道の駅', 'rest_area|services']) expect(query).toContain(tag);
  expect(query.endsWith('out body center;')).toBe(true);
});

it('splits node/way/relation data, keeps namespaces, rejects invalid coordinates and unnamed peaks', () => {
  const data = splitOsmResponse([...elements, elements[0],
    { type: 'relation', id: 2, center: { lat: 35, lon: 135 }, tags: { amenity: 'toilets' } },
    node(3, { natural: 'peak' }), node(4, { natural: 'peak', name: '山' }),
    { type: 'way', id: 5, tags: { shop: 'convenience' } }, node(6, { shop: 'convenience' }, NaN),
    { type: 'way', id: 7, center: { lat: 35, lon: 135 }, tags: { natural: 'peak', name: 'way山' } },
  ]);
  expect(data.places.map(p => p.id)).toEqual([1, 4]);
  expect(data.pois.map(p => `${p.type}/${p.id}`)).toEqual(['node/2', 'way/2', 'relation/2']);
});

it('selects exact POI predicates with michi priority and table ordering', () => {
  const tags: Record<string, string>[] = [
    { shop: 'convenience', name: '道の駅テスト' }, { highway: 'services', name: 'テスト道の駅' },
    { name: 'テスト道の駅' }, { amenity: 'vending_machine' }, { amenity: 'vending_machine', vending: 'food;drinks' },
    { amenity: 'vending_machine', vending: 'food' }, { man_made: 'water_tap' },
    { natural: 'spring', drinking_water: 'yes' }, { man_made: 'water_tap', drinking_water: 'yes' },
    { amenity: 'drinking_water', shop: 'general' }, { amenity: 'toilets' },
  ];
  expect(splitOsmResponse(tags.map((t, i) => node(i, t))).pois.map(p => [p.id, p.kind])).toEqual([
    [0, 'michi'], [1, 'michi'], [3, 'vend'], [4, 'vend'], [7, 'water'], [8, 'water'], [9, 'shop'], [10, 'wc'],
  ]);
});

it.each([[429, ''], [504, ''], [200, '{"remark":"runtime error: timeout"}'], [400, 'RATE_LIMITED']])('recognizes congestion: %s %s', (status, body) => {
  expect(isOverpassBusy(status as number, body as string)).toBe(true);
});
it('does not retry ordinary errors', () => {
  expect(isOverpassBusy(500, 'internal error')).toBe(false);
  expect(isOverpassBusy(200, '{"elements":[]}')).toBe(false);
});

it('fetches both datasets in one POST and reuses a successful result', async () => {
  const fetcher = vi.fn(async () => response()), provider = new OsmProvider(fetcher);
  const result = await provider.get(route);
  expect(result.places).toHaveLength(1); expect(result.pois).toHaveLength(2);
  await provider.get(route);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = (fetcher.mock.calls as unknown as Parameters<typeof fetch>[])[0];
  expect(url).toBe('https://overpass-api.de/api/interpreter'); expect(init?.method).toBe('POST');
  expect((init?.body as URLSearchParams).get('data')).toBe(buildOsmQuery(route));
});

it('filters each POI radius against the original route on every cache hit', async () => {
  const straight = [{ lat: 35, lng: 135 }, { lat: 35.02, lng: 135 }];
  const tags: Record<string, string>[] = [{ shop: 'convenience' }, { shop: 'bakery' }, { amenity: 'vending_machine' }, { amenity: 'drinking_water' }, { amenity: 'toilets' }, { name: '道の駅テスト' }];
  const data = tags.flatMap((tag, i) => [0.0005, 0.00165, 0.00275, 0.0044, 0.0066].map((lng, j): OsmElement => ({ type: 'node', id: i * 10 + j, lat: 35.01, lon: 135 + lng, tags: tag })));
  const fetcher = vi.fn(async () => response(data)), provider = new OsmProvider(fetcher);
  const first = await provider.get(straight);
  expect(first.pois.map(p => p.id)).toEqual([0, 1, 2, 10, 11, 12, 20, 30, 31, 40, 41, 50, 51, 52, 53]);
  const bent = [straight[0], { lat: 35.01, lng: 134.9998 }, straight[1]];
  expect(buildOsmQuery(bent)).toBe(buildOsmQuery(straight));
  const second = await provider.get(bent);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(second.pois[0].offset).toBeGreaterThan(first.pois[0].offset);
});

it('refetches POIs for a different line in the same bbox while retaining the place cache', async () => {
  const fetcher = vi.fn(async () => response()), provider = new OsmProvider(fetcher);
  const first = await provider.get(route);
  const alternate = [route[0], { ...route[1], lng: route[1].lng - 0.001 }, route[2]];
  expect(routeBBox(alternate)).toEqual(routeBBox(route));
  fetcher.mockResolvedValueOnce(response([]));
  const second = await provider.get(alternate);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(second.places).toEqual(first.places); expect(second.pois).toEqual([]);
});

it.each([429, 504, 200])('waits exactly 30 seconds and retries once for busy status %s', async status => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => response()).mockResolvedValueOnce(new Response('timeout', { status }));
  const busy = vi.fn(), provider = new OsmProvider(fetcher);
  const result = provider.get(route, () => true, busy);
  await vi.advanceTimersByTimeAsync(0);
  expect(busy).toHaveBeenCalledWith(true);
  await vi.advanceTimersByTimeAsync(29999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect((await result).places).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('stops after a second busy response and does not cache failures', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response('rate_limited', { status: 429 })), busy = vi.fn();
  const provider = new OsmProvider(fetcher);
  const failed = expect(provider.get(route, () => true, busy)).rejects.toThrow('Overpassが混雑中');
  await vi.advanceTimersByTimeAsync(60000); await failed;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(busy.mock.calls).toEqual([[true], [false]]);
  fetcher.mockResolvedValueOnce(response());
  expect((await provider.get(route)).pois).toHaveLength(2); expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each(['http', 'remark', 'invalid', 'network'])('does not retry or cache ordinary failure: %s', async failure => {
  const fetcher = vi.fn(async () => response());
  if (failure === 'network') fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else fetcher.mockResolvedValueOnce(failure === 'http' ? new Response('', { status: 500 }) : new Response(failure === 'remark' ? '{"elements":[],"remark":"incomplete"}' : '{}'));
  const provider = new OsmProvider(fetcher), busy = vi.fn();
  await expect(provider.get(route, () => true, busy)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(busy).not.toHaveBeenCalled();
  await provider.get(route); expect(fetcher).toHaveBeenCalledTimes(2);
});

it('skips a stale retry and serializes a newer request behind the cooldown', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => response()).mockResolvedValueOnce(new Response('', { status: 429 }));
  const provider = new OsmProvider(fetcher); let current = true;
  const old = provider.get(route, () => current);
  await vi.advanceTimersByTimeAsync(0); current = false;
  const next = provider.get(route);
  await vi.advanceTimersByTimeAsync(29999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await old).toEqual({ places: [], pois: [] }); expect((await next).places).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not fetch stale or overly broad routes', async () => {
  const fetcher = vi.fn(async () => response()), provider = new OsmProvider(fetcher);
  expect(await provider.get(route, () => false)).toEqual({ places: [], pois: [] });
  await expect(provider.get([{ lat: 35, lng: 135 }, { lat: 38, lng: 135 }])).rejects.toThrow('2度以内');
  expect(fetcher).not.toHaveBeenCalled();
});

it('bounds the successful caches to 32 entries', async () => {
  const fetcher = vi.fn(async () => response([])), provider = new OsmProvider(fetcher);
  const routes = Array.from({ length: 33 }, (_, i) => route.map(p => ({ ...p, lat: p.lat + i * 0.1 })));
  for (const points of routes) await provider.get(points);
  await provider.get(routes[32]); expect(fetcher).toHaveBeenCalledTimes(33);
  await provider.get(routes[0]); expect(fetcher).toHaveBeenCalledTimes(34);
});
