import { afterEach, expect, it, vi } from 'vitest';
import { annotationTiles, filterAnnotations, GsiPlaceProvider, peakSamples, type Annotation } from './gsi-places';
import { distance } from './geo';
import { tilePixel } from './elevation';
const route = [{ lat: 35, lng: 135 }, { lat: 35.02, lng: 135 }];
const feature = (knj: string, ftCode: string | number = '0332', lng = 135.001): Annotation => ({ properties: { knj, ftCode }, geometry: { type: 'Point', coordinates: [lng, 35.01] } });
const json = (features: Annotation[]) => new Response(JSON.stringify({ features }));
afterEach(() => vi.restoreAllMocks());
it('extracts passes, norikoshi and koshi, mountains but not ranges or other natural names', () => {
  const places = filterAnnotations([feature('和田峠'), feature('大乗越'), feature('三国越', 332), feature('温泉'), feature('高ボッチ山', '0312'), feature('榛名山', '0311')], route);
  expect(places.map(p => p.name)).toEqual(['和田峠', '大乗越', '三国越', '高ボッチ山']);
  expect(places.map(p => p.kind)).toEqual(['pass', 'pass', 'pass', 'peak']);
  expect(places.every(p => p.elevationSource === 'DEM')).toBe(true);
});
it('applies 250m/200m radii and snaps only passes to the nearest route point', () => {
  const lngAt = (m: number) => 135 + m / (6371008.8 * Math.PI / 180 * Math.cos(35.01 * Math.PI / 180));
  const places = filterAnnotations([feature('内峠', '0332', lngAt(249)), feature('外峠', '0332', lngAt(251)), feature('内山', '0312', lngAt(199)), feature('外山', '0312', lngAt(201))], route);
  expect(places.map(p => p.name)).toEqual(['内峠', '内山']);
  expect(places[0].lng).toBe(135); expect(places[0].lat).toBeCloseTo(35.01, 7);
  expect(places[0].routeDistance).toBeCloseTo(distance(route[0], route[1]) / 2);
  expect(places[1].lng).toBe(lngAt(199));
  expect(filterAnnotations([feature('和田峠')], [])).toEqual([]);
});
it('deduplicates tile features and ignores malformed coordinates/geometries', () => {
  expect(filterAnnotations([feature('和田峠'), feature('和田峠'), feature('無効峠', '0332', NaN), { ...feature('線峠'), geometry: { type: 'LineString', coordinates: [] } }], route)).toHaveLength(1);
});
it('covers z15 bbox with margin and caps long sparse routes to 80 along-route tiles', () => {
  const tiles = annotationTiles(route);
  const nw = tilePixel({ lat: 35.023, lng: 134.997 }, 15), se = tilePixel({ lat: 34.997, lng: 135.003 }, 15);
  expect(tiles).toHaveLength((se.x - nw.x + 1) * (se.y - nw.y + 1));
  expect(tiles).toContainEqual({ x: nw.x, y: nw.y });
  const long = annotationTiles([{ lat: 35, lng: 135 }, { lat: 36, lng: 136 }]);
  expect(long).toHaveLength(80);
  expect(new Set(long.map(t => `${t.x}/${t.y}`)).size).toBe(80);
  const middle = tilePixel({ lat: 35.5, lng: 135.5 }, 15);
  expect(long.some(t => Math.abs(t.x - middle.x) < 4 && Math.abs(t.y - middle.y) < 4)).toBe(true);
  expect(annotationTiles([])).toEqual([]);
});
it('uses one route DEM sample for passes and nine samples within 150m for peaks', async () => {
  const elevation = vi.fn(async (p: { lat: number; lng: number }) => p.lng > 135.001 ? 900 : 700);
  const request = vi.fn(async () => json([feature('和田峠'), feature('高山', '0312')]));
  const result = await new GsiPlaceProvider(elevation, request).get(route);
  expect(result.map(p => p.ele)).toEqual([700, 900]); expect(elevation).toHaveBeenCalledTimes(10);
  expect(elevation.mock.calls[0][0].lng).toBe(135);
  const centre = { lat: 35, lng: 135 };
  expect(peakSamples(centre)).toHaveLength(9);
  for (const p of peakSamples(centre).slice(1)) expect(distance(centre, p)).toBeCloseTo(150, 1);
  expect(request.mock.calls.length).toBe(annotationTiles(route).length);
});
it('caches 404 as empty but retries failed tiles, with a 15 second timeout', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
  const provider = new GsiPlaceProvider(async () => null, request);
  await provider.get(route); const count = request.mock.calls.length;
  await provider.get(route); expect(request).toHaveBeenCalledTimes(count);
  expect(String(request.mock.calls[0][0])).toMatch(/experimental_anno\/15\/\d+\/\d+\.geojson$/);
  expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  expect(timeout).toHaveBeenCalledWith(15000);
  const broken = vi.fn(async () => new Response('', { status: 500 }));
  const retry = new GsiPlaceProvider(async () => null, broken);
  await expect(retry.get(route)).rejects.toThrow(); await expect(retry.get(route)).rejects.toThrow();
  expect(broken).toHaveBeenCalledTimes(count * 2);
});
it('limits concurrent fetches to four and skips stale queued requests', async () => {
  let active = 0, maximum = 0, current = true;
  const release: (() => void)[] = [];
  const request = vi.fn(async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise<void>(resolve => release.push(resolve)); active--;
    return json([]);
  });
  const result = new GsiPlaceProvider(async () => null, request).get(route, () => current);
  expect(maximum).toBe(4); current = false; release.forEach(resolve => resolve());
  expect(await result).toEqual([]); expect(request).toHaveBeenCalledTimes(4);
});
it('retains partial tile results and missing DEM without invented elevations', async () => {
  const request = vi.fn(async () => json([feature('和田峠')])).mockRejectedValueOnce(new Error('timeout'));
  const places = await new GsiPlaceProvider(async () => null, request).get(route);
  expect(places).toHaveLength(1); expect(places[0].ele).toBeNull();
});
it('evicts the least recently used tile at 200 entries', async () => {
  const request = vi.fn(async () => json([]));
  const provider = new GsiPlaceProvider(async () => null, request);
  // The public API fills the cache; refreshing the first route keeps those tiles recent.
  const tracks = Array.from({ length: 60 }, (_, i) => route.map(p => ({ ...p, lng: p.lng + i * 0.03 })));
  for (const points of tracks.slice(0, 30)) await provider.get(points);
  await provider.get(tracks[0]);
  for (const points of tracks.slice(30)) await provider.get(points);
  const before = request.mock.calls.length;
  await provider.get(tracks.at(-1)!); expect(request).toHaveBeenCalledTimes(before);
  await provider.get(tracks[0]); expect(request).toHaveBeenCalledTimes(before);
  await provider.get(tracks[1]); expect(request.mock.calls.length).toBeGreaterThan(before);
});
