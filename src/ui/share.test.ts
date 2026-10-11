// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { shareRoute } from './share';

afterEach(() => vi.unstubAllGlobals());
function setup(coarse = true, available = true) {
  const share = vi.fn().mockResolvedValue(undefined), writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: query === '(pointer: coarse)' && coarse })));
  vi.stubGlobal('navigator', { share: available ? share : undefined, clipboard: { writeText } });
  const copied = vi.fn(), fallback = vi.fn(), shared = vi.fn();
  return { share, writeText, copied, fallback, shared, run: () => shareRoute('峠ルート', 'https://example.test/#route=test', copied, fallback, shared) };
}
it('uses native sharing on coarse pointers with the route title and URL', async () => {
  const s = setup(); await s.run();
  expect(s.share).toHaveBeenCalledWith({ title: '峠ルート', url: 'https://example.test/#route=test' });
  expect(s.shared).toHaveBeenCalledOnce(); expect(s.writeText).not.toHaveBeenCalled();
});
it.each([[false, true], [true, false]])('copies when coarse=%s and share available=%s', async (coarse, available) => {
  const s = setup(coarse, available); await s.run();
  expect(s.share).not.toHaveBeenCalled();
  expect(s.writeText).toHaveBeenCalledWith('https://example.test/#route=test');
  expect(s.copied).toHaveBeenCalledOnce();
});
it('ignores native share cancellation', async () => {
  const s = setup(); s.share.mockRejectedValue(new DOMException('cancel', 'AbortError')); await s.run();
  for (const callback of [s.writeText, s.copied, s.fallback, s.shared]) expect(callback).not.toHaveBeenCalled();
});
it('falls back to copying after native share failure', async () => {
  const s = setup(); s.share.mockRejectedValue(new Error('denied')); await s.run();
  expect(s.writeText).toHaveBeenCalledOnce(); expect(s.copied).toHaveBeenCalledOnce();
});
it('shows the URL when both native sharing and copying fail', async () => {
  const s = setup(); s.share.mockRejectedValue(new Error('denied')); s.writeText.mockRejectedValue(new Error('denied')); await s.run();
  expect(s.fallback).toHaveBeenCalledOnce(); expect(s.copied).not.toHaveBeenCalled();
});
it('shows the URL when clipboard is unavailable', async () => {
  const s = setup(false); vi.stubGlobal('navigator', {}); await s.run();
  expect(s.fallback).toHaveBeenCalledOnce();
});
