// @vitest-environment jsdom
import { afterAll, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import type { Sample } from '../elevation';
import type { Place } from '../types';
import { generateGPX, parseGPX } from '../gpx';
import { encodeRoute } from '../persistence';
import { Decoder, Stream } from '@garmin/fitsdk';
import { PIN_STORAGE_KEY } from '../pins';
const captured = vi.hoisted(() => ({ map: undefined as L.Map | undefined, alternative: false, straight: false, routeCalls: 0, detour: false, gsiWait: undefined as Promise<Place[]> | undefined }));
vi.mock('../map', async importOriginal => {
  const actual = await importOriginal<typeof import('../map')>();
  return { createMap: (...args: Parameters<typeof actual.createMap>) => { captured.map = actual.createMap(...args); return captured.map; } };
});
vi.mock('../gsi-places', () => ({ GsiPlaceProvider: class { get = async () => captured.gsiWait ?? [{ id: -1, name: '花脊峠', kind: 'pass', lat: 35.1587, lng: 135.7861, routeDistance: 1000, offset: 50, ele: 750, elevationSource: 'DEM' }]; } }));
vi.mock('../dem', () => ({ DemProvider: class { sample = async (samples: Sample[]) => samples.map((s, i) => ({ ...s, ele: 600 + i })); elevation = async () => 760; } }));
vi.mock('../routing', async importOriginal => {
  const actual = await importOriginal<typeof import('../routing')>();
  return { ...actual, Router: class {
    detour: InstanceType<typeof actual.Router>['detour'] = async (a, b, profile, mode) => captured.detour && mode === 'road'
      ? { key: actual.segmentKey(a, b, profile), osmM: 4500, gsiM: 1200 } : undefined;
    cached = () => undefined;
    route: InstanceType<typeof actual.Router>['route'] = async (points, _profiles, current = () => true, resolved, modes) => {
      captured.routeCalls++;
      return points.slice(1).map((p, i) => {
        const segment = { points: [points[i], { ...p, surface: modes?.[i] === 'road' ? 'paved' as const : undefined }], fallback: captured.straight && i === 0, profileUsed: captured.alternative ? 'trekking' : undefined, gsi: modes?.[i] === 'gsi' };
        if (current()) resolved?.(i, segment);
        return segment;
      });
    };
  } };
});
afterAll(() => { captured.map?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it('runs the full UI with Leaflet: edit, save, share, layers, GPX, clear and undo', async () => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
  const osmFetch = vi.fn(async () => new Response(JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.1587, lon: 135.7861, tags: { mountain_pass: 'yes', name: '花脊峠', ele: '760' } },
    { type: 'way', id: 2, center: { lat: 35.1587, lon: 135.7861 }, tags: { shop: 'convenience' } },
  ] })));
  let finishOsm!: (response: Response) => void;
  osmFetch.mockImplementationOnce(() => new Promise(resolve => { finishOsm = resolve; }));
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
  const created = vi.fn((_blob: Blob) => 'blob:test'); URL.createObjectURL = created; URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  localStorage.clear();
  await import('../main');
  const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!;
  const expectExportsDisabled = (disabled: boolean) => document.querySelectorAll<HTMLButtonElement>('[data-action="export"], [data-action="garmin"]').forEach(b => expect(b.disabled).toBe(disabled));
  const state = () => JSON.parse(localStorage.getItem('route-builder:v1')!);
  const settle = () => vi.advanceTimersByTimeAsync(2100);
  expect(button('#export').disabled).toBe(true);
  expectExportsDisabled(true);
  expect(document.getElementById('layer-pop')!.textContent).not.toContain('Google');
  expect(button('.controls [data-mode="gsi"]').getAttribute('aria-pressed')).toBe('true');
  button('[data-profile="gravel"]').click();
  expect(button('.controls [data-mode="road"]').getAttribute('aria-pressed')).toBe('true');
  button('[data-profile="mtb"]').click();
  expect(button('.controls [data-mode="gsi"]').getAttribute('aria-pressed')).toBe('true');
  button('.controls [data-mode="road"]').click();
  button('[data-profile="road"]').click();
  button('[data-profile="mtb"]').click();
  expect(button('.controls [data-mode="road"]').getAttribute('aria-pressed')).toBe('true');
  for (const [lat, lng] of [[35.15, 135.78], [35.1587, 135.7861]]) captured.map!.fire('click', { latlng: { lat, lng } });
  expect(state().points).toHaveLength(2); expect(button('#export').disabled).toBe(true); await settle();
  expect(document.getElementById('surface-summary')!.textContent).toMatch(/^舗装 [\d.]+km$/);
  expect(document.querySelector('#chart polygon')!.getAttribute('fill')).toBe('var(--surf-paved)');
  const callsBeforeChartMode = captured.routeCalls;
  button('[data-chart-mode="grade"]').click(); await settle();
  expect(document.querySelector('#chart polygon')!.getAttribute('fill')).toContain('var(--g');
  expect(document.querySelector('#chart-legend')!.textContent).toContain('下り');
  expect(captured.routeCalls).toBe(callsBeforeChartMode);
  button('[data-chart-mode="surface"]').click();
  expect(document.querySelector('#chart polygon')!.getAttribute('fill')).toBe('var(--surf-paved)');
  expect(document.querySelector('.pass-label')!.textContent).toContain('花脊峠750m');
  expect(document.getElementById('places')!.textContent).toContain('750 m');
  expect(document.querySelector('#chart svg')!.textContent).toContain('花脊峠');
  expectExportsDisabled(false);
  button('#export').click();
  expect(document.querySelector('.toast')!.textContent).toBe('峠・補給地点の一部は取得中のため含まれていません');
  const partialXml = new Promise<string>(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(created.mock.lastCall![0]);
  });
  await vi.runAllTimersAsync();
  expect(parseGPX(await partialXml).places.map(p => p.name)).toEqual(['花脊峠']);
  created.mockClear();
  // jsdom is not a coarse-pointer device: Garmin shares FITs only on (pointer: coarse), so emulate touch around Garmin clicks.
  const withTouchPointer = async (click: () => void) => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...originalMatchMedia.call(window, q), matches: q === '(pointer: coarse)' ? true : originalMatchMedia.call(window, q).matches })) as typeof window.matchMedia;
    try { click(); await vi.dynamicImportSettled(); await vi.advanceTimersByTimeAsync(0); }
    finally { window.matchMedia = originalMatchMedia; }
  };
  const partialShare = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', { configurable: true, value: partialShare });
  await withTouchPointer(() => button('#garmin').click());
  expect(partialShare).toHaveBeenCalledOnce();
  expect(document.querySelector('.toast')!.textContent).toBe('峠・補給地点の一部は取得中のため含まれていません');
  finishOsm(new Response(JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.1587, lon: 135.7861, tags: { mountain_pass: 'yes', name: '花脊峠', ele: '760' } },
    { type: 'way', id: 2, center: { lat: 35.1587, lon: 135.7861 }, tags: { shop: 'convenience' } },
  ] })));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelectorAll('.pass-label')).toHaveLength(1);
  expect(document.querySelector('.pass-label')!.textContent).toContain('花脊峠760m');
  expect(button('#export').disabled).toBe(false); expect(document.querySelector('.wp-marker.start')!.textContent).toBe('S'); expect(document.querySelector('.wp-marker.goal')!.textContent).toBe('G');
  expectExportsDisabled(false);
  expect(osmFetch).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(1);
  expect(document.getElementById('poi-list')!.textContent).toContain('コンビニ');
  expect(document.querySelectorAll('.chart-poi')).toHaveLength(1);
  expect(document.querySelector('.chart-gap')).toBeNull();
  const convChip = document.querySelector<HTMLButtonElement>('#poi-chips button')!;
  convChip.click(); expect(document.querySelectorAll('.poi-marker')).toHaveLength(0);
  expect(document.querySelectorAll('.chart-poi')).toHaveLength(0);
  convChip.click(); expect(document.querySelectorAll('.poi-marker')).toHaveLength(1);
  expect(document.querySelectorAll('.chart-poi')).toHaveLength(1);
  expect(osmFetch).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.pass-label')!.textContent).toContain('花脊峠'); expect(document.querySelector('#chart svg')).not.toBeNull();
  // Existing waypoint drags share live routing but persist only the final drop.
  const beforeMove = state(), callsBeforeMove = captured.routeCalls;
  let movingMarker: L.Marker | undefined;
  captured.map!.eachLayer(layer => {
    if (layer instanceof leaflet.Marker && layer.getElement()?.querySelector('.wp-marker.goal')) movingMarker = layer;
  });
  movingMarker!.setLatLng([35.159, 135.787]).fire('drag');
  expect(state()).toEqual(beforeMove);
  expect(document.querySelector('.route-line')!.getAttribute('stroke-dasharray')).toBe('6 8');
  await vi.advanceTimersByTimeAsync(1);
  expect(captured.routeCalls).toBe(callsBeforeMove + 1);
  expect(document.querySelector('.route-line')!.hasAttribute('stroke-dasharray')).toBe(false);
  movingMarker!.setLatLng([35.1595, 135.788]).fire('drag');
  await vi.advanceTimersByTimeAsync(399);
  expect(captured.routeCalls).toBe(callsBeforeMove + 2); expect(state()).toEqual(beforeMove);
  movingMarker!.setLatLng([35.16, 135.789]).fire('dragend');
  expect(state().points[1]).toEqual({ lat: 35.16, lng: 135.789 });
  button('#undo').click(); expect(state()).toEqual(beforeMove); await settle();
  const mapElement = document.getElementById('map')!; mapElement.setPointerCapture = vi.fn(); mapElement.releasePointerCapture = vi.fn(); mapElement.hasPointerCapture = () => true;
  const start = captured.map!.latLngToContainerPoint([35.15435, 135.78305]);
  for (const [type, delta] of [['pointerdown', 0], ['pointermove', 30], ['pointerup', 30]] as const) {
    const event = new MouseEvent(type, { clientX: start.x + delta, clientY: start.y + delta, button: 0, bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, isPrimary: { value: true } });
    (type === 'pointerdown' ? document.querySelector('.route-hit')! : document).dispatchEvent(event);
    if (type === 'pointermove') expect(state().points).toHaveLength(2);
  }
  expect(state().points).toHaveLength(3);
  expect(document.getElementById('poi-status')!.textContent).toContain('検索中');
  expect(document.getElementById('gap-note')!.hidden).toBe(true);
  expect(document.querySelectorAll('.poi-marker,.poi-row,.chart-poi,.chart-gap')).toHaveLength(0);
  expect([...document.querySelectorAll('.chip .count')].every(n => n.textContent === '0')).toBe(true);
  button('#undo').click(); expect(state().points).toHaveLength(2); await settle();
  const callsBeforeSelection = captured.routeCalls, shapeBeforeSelection = document.querySelector('.route-line')!.getAttribute('d');
  button('.m-top [data-profile="road"]').click(); expect(state().profile).toBe('road'); expect(document.querySelectorAll('[data-profile="road"][aria-pressed="true"]')).toHaveLength(2);
  expect(document.getElementById('status')!.textContent).toContain('これから引く区間をロードで計算します');
  expectExportsDisabled(false); await settle();
  expect(captured.routeCalls).toBe(callsBeforeSelection);
  expect(document.querySelector('.route-line')!.getAttribute('d')).toBe(shapeBeforeSelection);
  expect(state().legProfiles).toEqual(['mtb']);
  expect(document.querySelector('[data-waypoint="0"] .leg-profile')!.textContent).toContain('山サイ');
  expect(document.querySelector('[data-waypoint="1"] .leg-profile')).toBeNull();
  button('[data-waypoint="0"] .waypoint-focus').click();
  button('.waypoint-popup button:last-child').click(); expect(state().legProfiles).toEqual(['road']);
  button('#undo').click(); expect(state().legProfiles).toEqual(['mtb']); await settle();
  for (const selector of ['[data-waypoint="0"] .waypoint-actions button:first-child', '#menu-pop [data-action="reprofile-all"]', '#reprofile-all']) {
    button(selector).click(); expect(state().legProfiles).toEqual(['road']);
    button('#undo').click(); expect(state().legProfiles).toEqual(['mtb']); await settle();
  }
  const followCalls = captured.routeCalls, followPath = document.querySelector('.route-line'), drawSpy = vi.spyOn(leaflet.Polyline.prototype, 'setLatLngs');
  button('#menu-pop [data-mode="straight"]').click(); expect(state().mode).toBe('straight'); expect(button('.controls [data-mode="straight"]').getAttribute('aria-pressed')).toBe('true'); await settle();
  expect(captured.routeCalls).toBe(followCalls); expect(drawSpy).not.toHaveBeenCalled(); drawSpy.mockRestore();
  expect(document.querySelector('.route-line')).toBe(followPath); expectExportsDisabled(false);
  expect(state().legMode).toEqual(['road']);
  expect(document.getElementById('status')!.textContent).toContain('これから引く区間を直線で引きます');
  for (const selector of ['[data-waypoint="0"] .waypoint-actions button:first-child', '#menu-pop [data-action="reprofile-all"]', '#reprofile-all']) {
    button(selector).click(); expect(state().legMode).toEqual(['straight']); expect(state().legProfiles).toEqual(['road']);
    expect(document.querySelector('.leg-profile')!.textContent).toContain('直線');
    button('#undo').click(); expect(state().legMode).toEqual(['road']); expect(state().legProfiles).toEqual(['mtb']); await settle();
  }
  const point = document.querySelector<HTMLButtonElement>('[data-waypoint="1"] .del')!; point.click(); expect(state().points).toHaveLength(1); button('#undo').click(); expect(state().points).toHaveLength(2); await settle();
  button('#share').click(); await settle(); expect(copy).toHaveBeenCalledOnce(); expect((document.getElementById('share-url') as HTMLInputElement).hidden).toBe(true);
  copy.mockRejectedValueOnce(new Error('denied')); button('#share').click(); await settle(); const share = document.getElementById('share-url') as HTMLInputElement; expect(share.hidden).toBe(false); expect(share.selectionEnd).toBe(share.value.length);
  button('#layer-btn').click(); button('[aria-label="地理院 標準"]').click(); expect(localStorage.getItem('route-builder-background')).toBe('地理院 標準');
  button('#export').click(); expect(created).toHaveBeenCalledOnce();
  const exportedXml = async () => {
    const reading = new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
      reader.readAsText(created.mock.lastCall![0]);
    });
    // jsdom schedules FileReader events with the timers faked by this integration test.
    await vi.runAllTimersAsync();
    const xml = await reading;
    expect(parseGPX(xml).places.map(p => p.name)).toEqual(['花脊峠']);
    return new DOMParser().parseFromString(xml, 'application/xml');
  };
  expect((await exportedXml()).querySelectorAll('wpt')).toHaveLength(2);
  button('#poi-gpx').click(); button('#export').click();
  expect((await exportedXml()).querySelectorAll('wpt')).toHaveLength(1);
  button('#poi-gpx').click(); convChip.click(); button('#export').click();
  expect((await exportedXml()).querySelectorAll('wpt')).toHaveLength(1);
  convChip.click();
  // Both UI entry points use the resolved track, grouped POI selection and real encoder.
  const fitShare = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', { configurable: true, value: fitShare });
  const sharedFit = async () => {
    await vi.dynamicImportSettled();
    const reading = new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject;
      reader.readAsArrayBuffer(fitShare.mock.lastCall![0].files[0]);
    });
    await vi.runAllTimersAsync();
    const decoder = new Decoder(Stream.fromByteArray(new Uint8Array(await reading)));
    expect(decoder.isFIT()).toBe(true); expect(decoder.checkIntegrity()).toBe(true);
    const result = decoder.read(); expect(result.errors).toEqual([]); return result.messages;
  };
  await withTouchPointer(() => button('#garmin').click());
  const fit = await sharedFit();
  expect(fit.courseMesgs![0].subSport).toBe('mountain'); expect(fit.recordMesgs).toHaveLength(2);
  expect(fit.coursePointMesgs!.map(p => p.type)).toEqual(['summit', 'store']);
  button('#poi-gpx').click(); await withTouchPointer(() => button('.peek-row [data-action="garmin"]').click());
  expect((await sharedFit()).coursePointMesgs!.map(p => p.type)).toEqual(['summit']);
  button('#poi-gpx').click(); convChip.click(); await withTouchPointer(() => button('#garmin').click());
  expect((await sharedFit()).coursePointMesgs!.map(p => p.type)).toEqual(['summit']); convChip.click();
  fitShare.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
  const noticeBeforeCancel = document.getElementById('status')!.textContent;
  await withTouchPointer(() => button('#garmin').click()); await settle();
  expect(document.getElementById('status')!.textContent).toBe(noticeBeforeCancel);
  fitShare.mockRejectedValueOnce(new Error('share failed')); await withTouchPointer(() => button('#garmin').click()); await settle();
  expect(document.getElementById('status')!.textContent).toContain('FITを送信・保存できませんでした');
  expectExportsDisabled(false);
  // All mode selectors affect only new legs; redrawing preserves profiles and is undoable.
  const beforeGsi = state(), beforeGsiCalls = captured.routeCalls;
  for (const mode of ['gsi', 'road', 'straight', 'gsi']) {
    button(`#menu-pop [data-mode="${mode}"]`).click();
    expect(button(`.controls [data-mode="${mode}"]`).getAttribute('aria-pressed')).toBe('true');
    expect(state().legMode).toEqual(beforeGsi.legMode);
    expect(state().legProfiles).toEqual(beforeGsi.legProfiles);
    await settle(); expect(captured.routeCalls).toBe(beforeGsiCalls);
  }
  button('#reprofile-all').click(); await settle();
  expect(state().legMode).toEqual(['gsi']); expect(state().legProfiles).toEqual(['road']);
  expect(document.querySelector('.leg-profile')!.textContent).toContain('地理院');
  expect(document.getElementById('status')!.textContent).toContain('地理院の道で引いた区間は通行可否を確認していません');
  expect(document.getElementById('status')!.classList.contains('warn')).toBe(false);
  expect(document.querySelector('.leaflet-control-attribution')!.textContent).toContain('道路中心線: 地理院タイル');
  // GSI-only FIT falls back to the current profile even though the leg retains road.
  button('.m-top [data-profile="gravel"]').click(); await withTouchPointer(() => button('#garmin').click());
  expect((await sharedFit()).courseMesgs![0].subSport).toBe('gravelCycling');
  // A short road leg determines FIT subSport despite the longer GSI leg.
  button('.m-top [data-profile="mtb"]').click(); button('#menu-pop [data-mode="road"]').click();
  captured.map!.fire('click', { latlng: { lat: 35.1601, lng: 135.789 } }); await settle();
  expect(state().legMode).toEqual(['gsi', 'road']); await withTouchPointer(() => button('#garmin').click());
  expect((await sharedFit()).courseMesgs![0].subSport).toBe('mountain');
  button('#undo').click(); button('#undo').click(); await settle();
  expect(state().legMode).toEqual(beforeGsi.legMode);
  expect(document.querySelector('.leaflet-control-attribution')!.textContent).not.toContain('道路中心線');
  button('.m-top [data-profile="road"]').click();
  captured.alternative = true;
  button('#menu-pop [data-mode="road"]').click();
  captured.map!.fire('click', { latlng: { lat: 35.16, lng: 135.79 } }); await settle();
  expect(document.getElementById('status')!.textContent).toContain('一部区間を代替経路(trekking)で計算しました');
  expect(document.getElementById('status')!.classList.contains('warn')).toBe(true);
  captured.straight = true;
  captured.map!.fire('click', { latlng: { lat: 35.17, lng: 135.8 } }); await settle();
  expect(document.getElementById('status')!.textContent).toContain('該当区間は直線で表示しています');
  expect(document.getElementById('status')!.textContent).toContain('一部区間を代替経路(trekking)で計算しました');
  captured.alternative = captured.straight = false;
  button('#undo').click(); button('#undo').click(); await settle();
  expect(document.getElementById('status')!.textContent).not.toContain('代替経路');
  const imported = { ...state(), name: 'GPX確認', points: [{ lat: 35.15, lng: 135.78, ele: 650 }, { lat: 35.1587, lng: 135.7861, ele: 760 }] };
  const file = new File([''], 'route.gpx'); Object.defineProperty(file, 'text', { value: async () => generateGPX(imported, imported.points, []) });
  const input = document.getElementById('file') as HTMLInputElement; Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change')); await settle();
  expect(state().importedTrack).toHaveLength(2); expect(state().name).toBe('GPX確認'); expect(button('#export').disabled).toBe(false);
  expect(state().legProfiles).toEqual(['road']);
  const importedShape = document.querySelector('.route-line')!.getAttribute('d'), importedCalls = captured.routeCalls;
  button('.m-top [data-profile="gravel"]').click();
  button('.controls [data-mode="straight"]').click(); await settle();
  expect(state().legMode).toEqual(['road']);
  expect(state().importedTrack).toEqual(imported.points); expect(state().legProfiles).toEqual(['road']);
  expect(document.querySelector('.route-line')!.getAttribute('d')).toBe(importedShape);
  expect(captured.routeCalls).toBe(importedCalls); expectExportsDisabled(false);
  const hash = encodeRoute({ ...imported, name: '共有確認' }); window.history.replaceState(null, '', hash); window.dispatchEvent(new HashChangeEvent('hashchange')); await settle(); expect(state().name).toBe('共有確認'); expect(location.hash).toBe('');
  button('#clear').click(); expect(state().points).toHaveLength(0); button('#undo').click(); expect(state().points).toHaveLength(2); await settle();
  captured.map!.fire('click', { latlng: { lat: 35.15, lng: 135.78 } }); await settle();
  expect(document.querySelector('[data-waypoint="2"] .sub')!.textContent).not.toMatch(/^0\.0 km/);
  for (let i = 0; i < 3; i++) osmFetch.mockResolvedValueOnce(new Response('rate_limited', { status: 429 }));
  const beforeRetry = osmFetch.mock.calls.length;
  captured.map!.fire('click', { latlng: { lat: 35.16, lng: 135.79 } });
  await vi.advanceTimersByTimeAsync(1700);
  expect(document.getElementById('status')!.classList.contains('warn')).toBe(true);
  expect(document.getElementById('status')!.textContent).toContain('Overpassが混雑中');
  expect(document.getElementById('poi-status')!.textContent).toContain('Overpassが混雑中');
  expect(document.getElementById('gap-note')!.hidden).toBe(true);
  expectExportsDisabled(false);
  button('#share').click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.toast')!.textContent).toBe('共有URLをコピーしました');
  expect(document.getElementById('status')!.textContent).toContain('Overpassが混雑中');
  copy.mockRejectedValueOnce(new Error('denied'));
  button('#share').click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.toast')!.textContent).toBe('URLを表示しました。選択してコピーしてください');
  expect(document.getElementById('share-url')!.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(29999);
  expect(osmFetch).toHaveBeenCalledTimes(beforeRetry + 3);
  await vi.advanceTimersByTimeAsync(1);
  expect(osmFetch).toHaveBeenCalledTimes(beforeRetry + 4);
  expect(document.getElementById('status')!.textContent).not.toContain('Overpassが混雑中');
  expect(button('#export').disabled).toBe(false);
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(1);
  osmFetch.mockResolvedValueOnce(new Response('', { status: 400 }));
  captured.map!.fire('click', { latlng: { lat: 35.17, lng: 135.8 } }); await settle();
  expect(document.getElementById('poi-status')!.textContent).toContain('取得できませんでした');
  expect(document.querySelector('.pass-label')!.textContent).toContain('花脊峠750m');
  expect(document.getElementById('gap-note')!.hidden).toBe(true);
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(0);
  const longRoute = { ...imported, points: [{ lat: 35.1587, lng: 135.7861, ele: 760 }, { lat: 35.4587, lng: 135.7861, ele: 800 }] };
  const longFile = new File([''], 'long.gpx'); Object.defineProperty(longFile, 'text', { value: async () => generateGPX(longRoute, longRoute.points) });
  Object.defineProperty(input, 'files', { configurable: true, value: [longFile] }); input.dispatchEvent(new Event('change')); await settle();
  const gap = document.querySelector('.chart-gap')!;
  expect(gap).not.toBeNull(); expect(document.getElementById('gap-note')!.classList.contains('ok')).toBe(false);
  const gapWidth = gap.getAttribute('width');
  expect(document.querySelectorAll('.chart-poi')).toHaveLength(1);
  convChip.click(); expect(document.querySelectorAll('.chart-poi')).toHaveLength(0);
  expect(document.querySelector('.chart-gap')!.getAttribute('width')).toBe(gapWidth);
  button('#clear').click();
  expectExportsDisabled(true);
  expect(document.getElementById('surface-summary')!.textContent).toBe('');
  expect(document.querySelector('.chart-gap')).toBeNull();
  expect(document.getElementById('poi-status')!.textContent).toContain('ルートを描くと');
  // Exercise the main.ts wiring, including persistence, one-step Undo and clearing.
  captured.detour = true;
  button('.controls [data-mode="road"]').click();
  for (const lat of [36, 36.01, 36.02]) captured.map!.fire('click', { latlng: { lat, lng: 138 } });
  await settle();
  expect(document.querySelectorAll('.detour-leg')).toHaveLength(2);
  expect(document.querySelector('.detour-notice')!.textContent).toContain('2区間');
  button('.detour-notice button').click();
  expect(state().legMode).toEqual(['gsi', 'gsi']);
  expect(document.querySelector('.detour-leg')).toBeNull();
  button('#undo').click(); expect(state().legMode).toEqual(['road', 'road']); await settle();
  expect(document.querySelector('.detour-notice')).toBeNull();
  captured.map!.fire('click', { latlng: { lat: 36.03, lng: 138 } }); await settle();
  expect(document.querySelectorAll('.detour-leg')).toHaveLength(1);
  const name = document.getElementById('route-name') as HTMLInputElement;
  name.value = 'edited'; name.dispatchEvent(new Event('change'));
  expect(document.querySelector('.detour-leg')).toBeNull();
  captured.detour = false;
});

it('imports pins without routing/network changes; canvas popup appends a waypoint and one Undo restores the route', async () => {
  const leaflet = (await import('leaflet')).default;
  const context = new Proxy({}, { get: () => () => {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  const input = document.getElementById('file') as HTMLInputElement;
  const state = () => JSON.parse(localStorage.getItem('route-builder:v1')!);
  const previous = state(), network = vi.mocked(fetch).mock.calls.length, calls = captured.routeCalls;
  const read = async (name: string, text: string, size = 1) => {
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size, text: async () => text }] });
    await input.onchange!.call(input, new Event('change'));
  };
  const pins = () => {
    const result: L.CircleMarker[] = [];
    captured.map!.eachLayer(layer => { if (layer instanceof leaflet.CircleMarker && layer.options.pane === 'pinPane') result.push(layer); });
    return result;
  };
  const content = '<kml><Placemark><name>マイピン</name><Point><coordinates>138,36,800</coordinates></Point></Placemark><Placemark><LineString/></Placemark></kml>';
  await read('places.kml', content);
  expect(state()).toEqual(previous); expect(captured.routeCalls).toBe(calls); expect(vi.mocked(fetch).mock.calls).toHaveLength(network);
  expect(document.getElementById('status')!.textContent).toContain('ピンを1件読み込みました(1件はスキップ)');
  expect(document.querySelector('.toast')!.textContent).toContain('ピンを1件読み込みました');
  expect(pins()).toHaveLength(1); expect(pins()[0].options.renderer).toBeInstanceOf(leaflet.Canvas);
  expect(pins()[0].options.bubblingMouseEvents).toBe(false);
  expect(captured.map!.getPane('pinPane')!.style.zIndex).toBe('340');
  captured.map!.setZoom(11); expect(pins()[0].getRadius()).toBe(3);
  captured.map!.setZoom(12); expect(pins()[0].getRadius()).toBe(6);
  pins()[0].fire('click', { latlng: pins()[0].getLatLng() }, true);
  expect(state()).toEqual(previous);
  expect(document.querySelector('.pin-popup')!.textContent).toContain('マイピン');
  document.querySelector<HTMLButtonElement>('.pin-popup button')!.click();
  expect(document.querySelector('.toast')!.textContent).toBe('経由点を追加しました');
  expect(state().points).toEqual([...previous.points, { lat: 36, lng: 138 }]);
  document.getElementById('undo')!.click(); expect(state()).toEqual(previous);
  await read('places.kml', content); expect(pins()).toHaveLength(1);
  await read('another.kml', content); expect(pins()).toHaveLength(2);
  const check = document.querySelector<HTMLInputElement>('.pin-source input')!;
  check.click(); expect(pins()).toHaveLength(1); expect(JSON.parse(localStorage.getItem(PIN_STORAGE_KEY)!)[0].visible).toBe(false);
  expect(state()).toEqual(previous);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  document.querySelector<HTMLButtonElement>('.pin-delete')!.click(); expect(document.querySelectorAll('.pin-source')).toHaveLength(2);
  expect(state()).toEqual(previous);
  confirm.mockReturnValue(true); document.querySelector<HTMLButtonElement>('.pin-delete')!.click();
  expect(document.querySelectorAll('.pin-source')).toHaveLength(1);
  expect(state()).toEqual(previous);
  const stored = localStorage.getItem(PIN_STORAGE_KEY);
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
  await read('quota.kml', content);
  expect(pins()).toHaveLength(2); expect(localStorage.getItem(PIN_STORAGE_KEY)).toBe(stored);
  expect(document.getElementById('status')!.textContent).toContain('ピンを保存できません');
  expect(document.querySelector('.toast')!.textContent).toContain('ピンを保存できません');
  storage.mockRestore();
  await read('too-big.kml', content, 20_000_001); expect(pins()).toHaveLength(2);
  expect(document.getElementById('status')!.textContent).toContain('20MB');
  await read('bad.kml', '<kml>'); expect(pins()).toHaveLength(2);
  // A failed import must not replace any existing source.
  expect(JSON.parse(localStorage.getItem(PIN_STORAGE_KEY)!)).toHaveLength(1);
  await read('Saved Places.json', JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [135, 35] }, properties: { Title: 'Takeoutの場所' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
  ] }));
  expect(pins()).toHaveLength(3); expect(state()).toEqual(previous);
  expect(document.getElementById('status')!.textContent).toContain('ピンを1件読み込みました(1件はスキップ)');
  expect(JSON.parse(localStorage.getItem(PIN_STORAGE_KEY)!)).toHaveLength(3);
});

it('exports while GSI places are pending and clears the partial notice after completion', async () => {
  let finish!: (places: Place[]) => void;
  captured.gsiWait = new Promise(resolve => { finish = resolve; });
  captured.map!.fire('click', { latlng: { lat: 36.04, lng: 138 } });
  await vi.advanceTimersByTimeAsync(2100);
  document.querySelectorAll<HTMLButtonElement>('[data-action="export"], [data-action="garmin"]').forEach(b => expect(b.disabled).toBe(false));
  document.getElementById('export')!.click();
  expect(document.querySelector('.toast')!.textContent).toContain('一部は取得中');
  finish([]); captured.gsiWait = undefined;
  await vi.advanceTimersByTimeAsync(0);
  document.getElementById('export')!.click();
  expect(document.querySelector('.toast')!.textContent).toBe('GPXを保存しました');
});

it('wires the mobile share action to native sharing, silent cancellation and clipboard fallback', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', addEventListener() {} }));
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  const button = document.querySelector<HTMLButtonElement>('#menu-pop [data-action="share"]')!;
  button.click(); await vi.advanceTimersByTimeAsync(0);
  const state = JSON.parse(localStorage.getItem('route-builder:v1')!);
  expect(share).toHaveBeenCalledWith({ title: state.name, url: expect.stringContaining('#route=') });
  expect(document.querySelector('.toast')!.textContent).toBe('ルートを共有しました');
  await vi.advanceTimersByTimeAsync(3000);
  share.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
  const copies = vi.mocked(navigator.clipboard.writeText).mock.calls.length;
  button.click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.toast')!.textContent).toBe('');
  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(copies);
  share.mockRejectedValueOnce(new Error('denied'));
  button.click(); await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.toast')!.textContent).toBe('共有URLをコピーしました');
});
