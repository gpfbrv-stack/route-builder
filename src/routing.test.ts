import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Router, routingWarnings, segmentKey } from './routing';
import { ProfileRegistry } from './brouter-profiles';
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
  expect(segmentKey(points[0], points[1], 'road')).toBe('road:135.000000,35.000000|135.000000,35.010000');
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
