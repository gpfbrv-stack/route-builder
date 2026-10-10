// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { GoogleSessions, sessionValid, sessionBody, viewportBounds, viewportParams, nativeZoom } from './google';
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
  expect(nativeZoom({ copyright: 'test', maxZoomRects: [{ maxZoom: 19, north: 90, south: -90, east: 180, west: -180 }, { maxZoom: 15, north: 90, south: -90, east: 180, west: -180 }] })).toBe(15);
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
