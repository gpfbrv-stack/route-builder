// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { GoogleSessions, sessionValid, sessionBody, viewportBounds, viewportParams, nativeZoom, type GoogleViewport } from './google';
const session = (seconds: number) => ({ session: 'test-session', expiry: String(seconds), tileWidth: 512, tileHeight: 512 });
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
