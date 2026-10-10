import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileRegistry } from './brouter-profiles';
import road from './brouter-profiles/road-jp.brf?raw';
import { CONFIG } from './config';

let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const registered = (id = 'custom_123') => new Response(JSON.stringify({ profileid: id }));

it('registers the raw profile once and reuses it in memory and session storage', async () => {
  const request = vi.fn(async () => registered());
  const registry = new ProfileRegistry(request);
  expect(await registry.id('road-jp')).toBe('custom_123');
  expect(await registry.id('road-jp')).toBe('custom_123');
  expect(await new ProfileRegistry(request).id('road-jp')).toBe('custom_123');
  expect(request).toHaveBeenCalledExactlyOnceWith('https://brouter.de/brouter/profile', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: road, signal: expect.any(AbortSignal),
  });
});
it('shares concurrent registrations and registers each key separately', async () => {
  const request = vi.fn(async () => registered());
  const registry = new ProfileRegistry(request);
  const first = registry.id('mtb-jp');
  expect(registry.id('mtb-jp')).toBe(first);
  await Promise.all([first, registry.id('mtb-jp'), registry.id('gravel-jp')]);
  expect(request).toHaveBeenCalledTimes(2);
});
it('invalidates memory and session storage', async () => {
  const request = vi.fn().mockResolvedValueOnce(registered()).mockResolvedValueOnce(registered('custom_456'));
  const registry = new ProfileRegistry(request);
  await registry.id('road-jp'); registry.invalidate('road-jp');
  expect(saved.size).toBe(0);
  expect(await registry.id('road-jp')).toBe('custom_456');
  expect(request).toHaveBeenCalledTimes(2);
});
it('does not let an invalidated in-flight registration overwrite its replacement', async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(registered('custom_456'));
  const registry = new ProfileRegistry(request);
  const old = registry.id('road-jp'); registry.invalidate('road-jp');
  expect(await registry.id('road-jp')).toBe('custom_456');
  finish(registered()); await old;
  expect(await registry.id('road-jp')).toBe('custom_456');
  expect(await new ProfileRegistry(request).id('road-jp')).toBe('custom_456');
});
it.each([
  () => Promise.reject(new Error('offline')),
  () => Promise.resolve(new Response('', { status: 500 })),
  () => Promise.resolve(new Response('invalid json')),
  () => Promise.resolve(new Response('null')),
  () => Promise.resolve(registered('mtb')),
  () => Promise.resolve(new Response('{}')),
])('rejects registration failures without caching them', async fail => {
  const request = vi.fn().mockImplementationOnce(fail).mockResolvedValueOnce(registered());
  const registry = new ProfileRegistry(request);
  await expect(registry.id('road-jp')).rejects.toThrow();
  expect(saved.size).toBe(0);
  expect(await registry.id('road-jp')).toBe('custom_123');
});
it('uses memory when session storage access throws', async () => {
  vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } });
  const request = vi.fn(async () => registered());
  const registry = new ProfileRegistry(request);
  await registry.id('road-jp'); await registry.id('road-jp');
  expect(request).toHaveBeenCalledOnce();
  registry.invalidate('road-jp'); await registry.id('road-jp');
  expect(request).toHaveBeenCalledTimes(2);
});
it.each(['broken', JSON.stringify({ id: 'custom_999', source: 'old profile' }), JSON.stringify({ id: 'mtb', source: road })])('ignores corrupt or outdated stored profiles', async value => {
  saved.set('brouter-profile:road-jp', value);
  const request = vi.fn(async () => registered());
  expect(await new ProfileRegistry(request).id('road-jp')).toBe('custom_123');
  expect(request).toHaveBeenCalledOnce();
});
it('applies the configured timeout to registration', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  await new ProfileRegistry(vi.fn(async () => registered())).id('road-jp');
  expect(timeout).toHaveBeenCalledWith(CONFIG.routing.timeoutMs);
});
