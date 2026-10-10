import { expect, it, vi } from 'vitest';
import { Router } from './routing';
const points = Array.from({ length: 5 }, (_, i) => ({ lat: 35 + i / 100, lng: 135 }));
function response() { return new Response(JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates: [[135, 35], [135, 35.01]] } }] })); }
it('retries mtb with trekking and caches the alternative under the requested profile and segment', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('no track found at pass=0', { status: 400 }))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response());
  const router = new Router(fetcher);
  const segment = await router.segment(points[0], points[1], 'mtb');
  expect(segment).toEqual({ points: points.slice(0, 2), fallback: false, profileUsed: 'trekking' });
  expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get('profile'))).toEqual(['mtb', 'trekking']);
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get('lonlats')).toBe(new URL(fetcher.mock.calls[1][0]).searchParams.get('lonlats'));
  expect(await router.segment(points[0], points[1], 'mtb')).toEqual(segment);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await router.segment(points[0], points[1], 'gravel')).profileUsed).toBe('gravel');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('uses a straight line after both profiles fail, without caching the failure', async () => {
  const fetcher = vi.fn(async () => new Response('no track found at pass=0', { status: 400 }));
  const router = new Router(fetcher);
  expect(await router.segment(points[0], points[1], 'mtb')).toEqual({ points: points.slice(0, 2), fallback: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await router.segment(points[0], points[1], 'mtb');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it.each(['gravel', 'road'] as const)('does not try alternatives for %s', async profile => {
  const fetcher = vi.fn(async () => new Response('no track found at pass=0', { status: 400 }));
  expect((await new Router(fetcher).segment(points[0], points[1], profile)).fallback).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
});
it('refetches only the two neighbours after a drag', async () => {
  const fetcher = vi.fn(async () => response()); const router = new Router(fetcher);
  await router.route(points, 'mtb'); expect(fetcher).toHaveBeenCalledTimes(4);
  await router.route(points.map((p, i) => i === 2 ? { ...p, lng: 135.001 } : p), 'mtb');
  expect(fetcher).toHaveBeenCalledTimes(6);
  await router.route(points, 'road'); expect(fetcher).toHaveBeenCalledTimes(10);
});
it('limits concurrency and shares in-flight requests', async () => {
  let active = 0; let peak = 0;
  const fetcher = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return response(); });
  const router = new Router(fetcher);
  await Promise.all([router.route(points, 'mtb'), router.route(points, 'mtb')]);
  expect(peak).toBeLessThanOrEqual(2); expect(fetcher).toHaveBeenCalledTimes(4);
});
it('falls back without poisoning cache', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response());
  const router = new Router(fetcher);
  expect((await router.segment(points[0], points[1], 'mtb')).fallback).toBe(true);
  expect((await router.segment(points[0], points[1], 'mtb')).fallback).toBe(false);
});
it('stops scheduling obsolete segments', async () => {
  const fetcher = vi.fn(async () => response());
  expect(await new Router(fetcher).route(points, 'mtb', () => false)).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});
it('calls browser fetch without a Router receiver', async () => {
  vi.stubGlobal('fetch', function(this: unknown) { if (this instanceof Router) throw new Error('Illegal invocation'); return Promise.resolve(response()); });
  try { expect((await new Router().segment(points[0], points[1], 'mtb')).fallback).toBe(false); }
  finally { vi.unstubAllGlobals(); }
});
