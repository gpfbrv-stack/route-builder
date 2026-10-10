// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { GoogleLayer } from './google-layer';
import { GoogleSessions, sessionValid, sessionBody, viewportBounds, viewportParams, nativeZoom, type GoogleViewport } from './google';
const session = (seconds: number) => ({ session: 'test-session', expiry: String(seconds), tileWidth: 512, tileHeight: 512 });
describe('Google background transitions', () => {
  let map: L.Map;
  afterEach(() => {
    map?.remove(); document.body.replaceChildren();
    vi.restoreAllMocks(); vi.useRealTimers();
  });
  async function setup() {
    vi.useFakeTimers();
    // Real Leaflet layers/events, but no image URLs are requested.
    vi.spyOn(L.TileLayer.prototype, 'createTile').mockImplementation(() => document.createElement('div'));
    const factory = vi.spyOn(L, 'tileLayer');
    const opacity = vi.spyOn(L.TileLayer.prototype, 'setOpacity');
    let zoom = 19, token = 'first', copyright = 'first attribution';
    const sessions = new GoogleSessions('test-key');
    vi.spyOn(sessions, 'get').mockImplementation(async () => ({ ...session(Date.now() / 1000 + 7200), session: token }));
    const request = vi.fn(async () => new Response(JSON.stringify({ copyright, maxZoomRects: [
      { north: 90, south: -90, west: -180, east: 180, maxZoom: zoom },
    ] })));
    const container = document.createElement('div'); document.body.append(container);
    map = L.map(container, { fadeAnimation: false }).setView([35, 135], 12);
    const layer = new GoogleLayer('roadmap', 'test-key', sessions, vi.fn(), vi.fn(), request).addTo(map);
    await vi.advanceTimersByTimeAsync(0);
    const tiles = () => factory.mock.results.map(result => result.value as L.TileLayer);
    const refresh = async (nextZoom = zoom, nextToken = token) => {
      zoom = nextZoom; token = nextToken; copyright = 'updated attribution';
      map.fire('movestart').fire('moveend');
      await vi.advanceTimersByTimeAsync(400);
    };
    return { layer, tiles, refresh, request, opacity };
  }
  it('keeps tiles and attribution visible during movement and debounces viewport updates without rebuilding', async () => {
    const { tiles, refresh, request, opacity } = await setup();
    const first = tiles()[0];
    map.fire('movestart').fire('zoomstart');
    expect(opacity).not.toHaveBeenCalled();
    expect(map.hasLayer(first)).toBe(true);
    expect(map.getContainer().textContent).toContain('first attribution');
    map.fire('moveend').fire('zoomend');
    await vi.advanceTimersByTimeAsync(399);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await refresh();
    expect(tiles()).toEqual([first]);
    expect(opacity).not.toHaveBeenCalled();
    expect(map.getContainer().textContent).toContain('updated attribution');
  });
  it.each(['zoom', 'token'])('adds the new layer before removing the old one on load when %s changes', async reason => {
    const { tiles, refresh } = await setup();
    await refresh(reason === 'zoom' ? 18 : 19, reason === 'token' ? 'second' : 'first');
    const [old, next] = tiles();
    expect(tiles()).toHaveLength(2);
    expect(map.hasLayer(old)).toBe(true); expect(map.hasLayer(next)).toBe(true);
    old.fire('load'); expect(map.hasLayer(old)).toBe(true);
    next.fire('load');
    expect(map.hasLayer(old)).toBe(false); expect(map.hasLayer(next)).toBe(true);
  });
  it('retires old tiles after exactly five seconds if load never arrives', async () => {
    const { tiles, refresh } = await setup(); await refresh(18);
    const [old, next] = tiles();
    await vi.advanceTimersByTimeAsync(4999); expect(map.hasLayer(old)).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(map.hasLayer(old)).toBe(false);
    expect(map.hasLayer(next)).toBe(true);
  });
  it('keeps predecessors until the latest replacement loads during overlapping swaps', async () => {
    const { tiles, refresh } = await setup(); await refresh(18); await refresh(17);
    const [old, intermediate, latest] = tiles();
    intermediate.fire('load'); expect(map.hasLayer(old)).toBe(true);
    latest.fire('load');
    expect(map.hasLayer(old)).toBe(false); expect(map.hasLayer(intermediate)).toBe(false);
    expect(map.hasLayer(latest)).toBe(true);
  });
  it('cleans up both layers and pending load handlers when the background is removed', async () => {
    const { layer, tiles, refresh, request } = await setup(); await refresh(18);
    layer.remove();
    for (const tile of tiles()) { expect(map.hasLayer(tile)).toBe(false); expect(tile.listens('load')).toBe(false); }
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(map.getContainer().textContent).not.toContain('updated attribution');
  });
});
it('refreshes exactly one hour before expiry, in epoch seconds', () => {
  expect(sessionValid(session(7200), 3599999)).toBe(true);
  expect(sessionValid(session(7200), 3600000)).toBe(false);
  expect(sessionValid(session(NaN), 0)).toBe(false); expect(sessionValid(null)).toBe(false);
});
it('generates wrapped and clamped viewport bounds', () => {
  expect(viewportBounds({ north: 95, south: -95, west: 170, east: 190 })).toEqual({ north: 85.05112878, south: -85.05112878, west: 170, east: -170 });
  expect(viewportBounds({ north: 40, south: 30, west: -540, east: 540 }).east).toBeLessThan(180);
  expect(viewportParams({ north: 36, south: 35, east: 136, west: 135 }, 16.8).get('zoom')).toBe('16');
  expect(() => viewportBounds({ north: NaN, south: 0, east: 0, west: 0 })).toThrow();
});
it('uses required terrain layer and configurable DPI', () => {
  expect(sessionBody('terrain').layerTypes).toEqual(['layerRoadmap']);
  expect(sessionBody('roadmap').layerTypes).toBeUndefined();
  expect(sessionBody('satellite', { scale: 'scaleFactor1x', highDpi: false }).highDpi).toBe(false);
  expect(nativeZoom({ copyright: 'test', maxZoomRects: [{ maxZoom: 19, north: 90, south: -90, east: 180, west: -180 }, { maxZoom: 15, north: 90, south: -90, east: 180, west: -180 }] }, { lat: 35.16, lng: 135.78 })).toBe(19);
});
// Synthetic bounds reproduce the reported Hanase terrain response structure.
const hanaseViewport: GoogleViewport = { copyright: 'test', maxZoomRects: [
  { north: 90, south: -90, west: -180, east: 180, maxZoom: 19 },
  { north: 90, south: -90, west: -180, east: 180, maxZoom: 9 },
  { north: 85, south: -85, west: -179, east: 179, maxZoom: 13 },
  { north: 80, south: -80, west: -178, east: 178, maxZoom: 14 },
  { north: 46, south: 24, west: 123, east: 146, maxZoom: 16 },
  { north: 35.3, south: 35, west: 135.5, east: 136, maxZoom: 13 },
  { north: 35.2, south: 35.1, west: 135.7, east: 135.9, maxZoom: 18 },
  { north: 35.18, south: 35.15, west: 135.77, east: 135.80, maxZoom: 20 },
] };
it('uses the highest covering zoom in mixed world and regional terrain rectangles', () => {
  expect(nativeZoom(hanaseViewport, { lat: 35.1587, lng: 135.7861 })).toBe(20);
  expect(nativeZoom(hanaseViewport, { lat: 35.19, lng: 135.776 })).toBe(19);
});
it('prefers covering rectangles and falls back to all rectangles only when none cover', () => {
  const viewport = { copyright: 'test', maxZoomRects: hanaseViewport.maxZoomRects.slice(5) };
  expect(nativeZoom(viewport, { lat: 35.19, lng: 135.776 })).toBe(18);
  expect(nativeZoom(viewport, { lat: 34, lng: 134 })).toBe(20);
  expect(nativeZoom(viewport, { lat: 35.18, lng: 135.80 })).toBe(20);
});
it('handles antimeridian rectangles and wrapped center longitudes', () => {
  const viewport = { copyright: 'test', maxZoomRects: [
    { north: 90, south: -90, west: -180, east: 180, maxZoom: 9 },
    { north: 40, south: 30, west: 170, east: -170, maxZoom: 18 },
  ] };
  for (const lng of [175, -175, 185]) expect(nativeZoom(viewport, { lat: 35, lng })).toBe(18);
  expect(nativeZoom(viewport, { lat: 35, lng: 0 })).toBe(9);
});
it('ignores invalid zoom values and rejects missing valid availability', () => {
  const invalid = [-1, 23, 18.5, NaN].map(maxZoom => ({ north: 90, south: -90, west: -180, east: 180, maxZoom }));
  const center = { lat: 35.1587, lng: 135.7861 };
  expect(nativeZoom({ copyright: 'test', maxZoomRects: [...invalid, ...hanaseViewport.maxZoomRects] }, center)).toBe(20);
  for (const maxZoomRects of [[], invalid]) expect(() => nativeZoom({ copyright: 'test', maxZoomRects }, center)).toThrow('Google viewport has no zoom availability');
});
it('deduplicates sessions, separates map types, and reuses localStorage', async () => {
  localStorage.clear();
  const fetcher = vi.fn(async () => new Response(JSON.stringify(session(Date.now() / 1000 + 7200))));
  const client = new GoogleSessions('test-key', undefined, fetcher);
  await Promise.all([client.get('roadmap'), client.get('roadmap')]); expect(fetcher).toHaveBeenCalledTimes(1);
  await client.get('terrain'); expect(fetcher).toHaveBeenCalledTimes(2);
  await new GoogleSessions('test-key', undefined, fetcher).get('roadmap'); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]).toBeDefined();
});
it('survives unavailable localStorage, retries failed sessions, and renews expiry', async () => {
  localStorage.clear();
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockImplementation(async () => new Response(JSON.stringify(session(Date.now() / 1000 + 7200))));
  const client = new GoogleSessions('test-expiry', undefined, fetcher);
  await expect(client.get('roadmap')).rejects.toThrow(/403/);
  await client.get('roadmap'); expect(fetcher).toHaveBeenCalledTimes(2);
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 3601000);
  await client.get('roadmap'); expect(fetcher).toHaveBeenCalledTimes(3);
  vi.restoreAllMocks(); storage.mockRestore();
});
