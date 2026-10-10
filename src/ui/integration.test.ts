// @vitest-environment jsdom
import { afterAll, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import type { Sample } from '../elevation';
import { generateGPX } from '../gpx';
import { encodeRoute } from '../persistence';
const captured = vi.hoisted(() => ({ map: undefined as L.Map | undefined }));
vi.mock('../map', async importOriginal => {
  const actual = await importOriginal<typeof import('../map')>();
  return { createMap: (...args: Parameters<typeof actual.createMap>) => { captured.map = actual.createMap(...args); return captured.map; } };
});
vi.mock('../dem', () => ({ DemProvider: class { sample = async (samples: Sample[]) => samples.map((s, i) => ({ ...s, ele: 600 + i })); elevation = async () => 760; } }));
vi.mock('../routing', async importOriginal => {
  const actual = await importOriginal<typeof import('../routing')>();
  return { ...actual, Router: class { route = async (points: Sample[]) => points.slice(1).map((p, i) => ({ points: [points[i], p], fallback: false })); } };
});
afterAll(() => { captured.map?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('runs the full UI with Leaflet: edit, save, share, layers, GPX, clear and undo', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
  const osmFetch = vi.fn(async () => new Response(JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.1587, lon: 135.7861, tags: { mountain_pass: 'yes', name: '花脊峠', ele: '760' } },
    { type: 'way', id: 2, center: { lat: 35.1587, lon: 135.7861 }, tags: { shop: 'convenience' } },
  ] })));
  vi.stubGlobal('fetch', osmFetch);
  document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value: () => ({}) });
  const leaflet = (await import('leaflet')).default;
  // jsdom has no SVG renderer/layout detection. Enable Leaflet's normal SVG path.
  Object.defineProperty(leaflet.Browser, 'svg', { configurable: true, value: true });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.id === 'map' ? 880 : 360; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.id === 'map' ? 800 : 400; } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const copy = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const created = vi.fn(() => 'blob:test'); URL.createObjectURL = created; URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  localStorage.clear();
  await import('../main');
  const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
  const state = () => JSON.parse(localStorage.getItem('route-builder:v1')!);
  const settle = () => vi.advanceTimersByTimeAsync(2100);
  expect(button('#export').disabled).toBe(true);
  expect(document.getElementById('layer-pop')!.textContent).not.toContain('Google');
  for (const [lat, lng] of [[35.15, 135.78], [35.1587, 135.7861]]) captured.map!.fire('click', { latlng: { lat, lng } });
  expect(state().points).toHaveLength(2); expect(button('#export').disabled).toBe(true); await settle();
  expect(button('#export').disabled).toBe(false); expect(document.querySelector('.wp-marker.start')!.textContent).toBe('S'); expect(document.querySelector('.wp-marker.goal')!.textContent).toBe('G');
  expect(osmFetch).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.pass-label')!.textContent).toContain('花脊峠'); expect(document.querySelector('#chart svg')).not.toBeNull();
  const mapElement = document.getElementById('map')!; mapElement.setPointerCapture = vi.fn(); mapElement.releasePointerCapture = vi.fn(); mapElement.hasPointerCapture = () => true;
  const start = captured.map!.latLngToContainerPoint([35.15435, 135.78305]);
  for (const [type, delta] of [['pointerdown', 0], ['pointermove', 30], ['pointerup', 30]] as const) {
    const event = new MouseEvent(type, { clientX: start.x + delta, clientY: start.y + delta, button: 0, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } });
    (type === 'pointerdown' ? document.querySelector('.route-line')! : document).dispatchEvent(event);
    if (type === 'pointermove') expect(state().points).toHaveLength(2);
  }
  expect(state().points).toHaveLength(3); button('#undo').click(); expect(state().points).toHaveLength(2); await settle();
  button('.m-top [data-profile="road"]').click(); expect(state().profile).toBe('road'); expect(document.querySelectorAll('[data-profile="road"][aria-pressed="true"]')).toHaveLength(2); await settle();
  button('#menu-pop [data-follow]').click(); expect(state().followRoad).toBe(false); expect((document.getElementById('follow') as HTMLInputElement).checked).toBe(false); await settle();
  const point = document.querySelector<HTMLButtonElement>('[data-waypoint="1"] .del')!; point.click(); expect(state().points).toHaveLength(1); button('#undo').click(); expect(state().points).toHaveLength(2); await settle();
  button('#share').click(); await settle(); expect(copy).toHaveBeenCalledOnce(); expect((document.getElementById('share-url') as HTMLInputElement).hidden).toBe(true);
  copy.mockRejectedValueOnce(new Error('denied')); button('#share').click(); await settle(); const share = document.getElementById('share-url') as HTMLInputElement; expect(share.hidden).toBe(false); expect(share.selectionEnd).toBe(share.value.length);
  button('#layer-btn').click(); button('[aria-label="地理院 標準"]').click(); expect(localStorage.getItem('route-builder-background')).toBe('地理院 標準');
  button('#export').click(); expect(created).toHaveBeenCalledOnce();
  const imported = { ...state(), name: 'GPX確認', points: [{ lat: 35.15, lng: 135.78, ele: 650 }, { lat: 35.1587, lng: 135.7861, ele: 760 }] };
  const file = new File([''], 'route.gpx'); Object.defineProperty(file, 'text', { value: async () => generateGPX(imported, imported.points, []) });
  const input = document.getElementById('file') as HTMLInputElement; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change')); await settle();
  expect(state().importedTrack).toHaveLength(2); expect(state().name).toBe('GPX確認'); expect(button('#export').disabled).toBe(false);
  const hash = encodeRoute({ ...imported, name: '共有確認' }); window.history.replaceState(null, '', hash); window.dispatchEvent(new HashChangeEvent('hashchange')); await settle(); expect(state().name).toBe('共有確認'); expect(location.hash).toBe('');
  button('#clear').click(); expect(state().points).toHaveLength(0); button('#undo').click(); expect(state().points).toHaveLength(2); await settle();
  captured.map!.fire('click', { latlng: { lat: 35.15, lng: 135.78 } }); await settle();
  expect(document.querySelector('[data-waypoint="2"] .sub')!.textContent).not.toMatch(/^0\.0 km/);
  osmFetch.mockResolvedValueOnce(new Response('rate_limited', { status: 429 }));
  const beforeRetry = osmFetch.mock.calls.length;
  captured.map!.fire('click', { latlng: { lat: 35.16, lng: 135.79 } });
  await vi.advanceTimersByTimeAsync(1700);
  expect(document.getElementById('status')!.classList.contains('warn')).toBe(true);
  expect(document.getElementById('status')!.textContent).toContain('Overpassが混雑中');
  expect(button('#export').disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(29999);
  expect(osmFetch).toHaveBeenCalledTimes(beforeRetry + 1);
  await vi.advanceTimersByTimeAsync(1);
  expect(osmFetch).toHaveBeenCalledTimes(beforeRetry + 2);
  expect(document.getElementById('status')!.textContent).not.toContain('Overpassが混雑中');
  expect(button('#export').disabled).toBe(false);
});
