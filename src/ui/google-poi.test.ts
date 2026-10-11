// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { createMap } from '../map';
import { GoogleLayer } from '../google-layer';
import { GoogleSessions } from '../google';
import { GOOGLE_POI_STORAGE_KEY } from './google-poi';

let map: L.Map;
const notify = vi.fn();
const request = vi.fn(async () => new Response(JSON.stringify({ copyright: 'Google test <copyright>', maxZoomRects: [
  { north: 90, south: -90, west: -180, east: 180, maxZoom: 18 },
] })));
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); notify.mockClear(); request.mockClear();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key'); vi.stubGlobal('fetch', request);
  vi.spyOn(GoogleSessions.prototype, 'get').mockResolvedValue({ session: 'fake', expiry: String(Date.now() / 1000 + 7200), tileWidth: 512, tileHeight: 512 });
  vi.spyOn(L.TileLayer.prototype, 'createTile').mockImplementation(() => document.createElement('div'));
});
afterEach(() => { map?.remove(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const settle = () => vi.advanceTimersByTimeAsync(400);
async function setup() {
  document.body.innerHTML = '<div id="map"></div><div id="layer-pop"></div><button id="layer-btn"></button><button data-action="zoom-in"></button><button data-action="zoom-out"></button><button data-action="locate"></button>';
  map = createMap('map', notify); await settle();
}
const toggle = () => document.querySelector<HTMLInputElement>('.google-poi-options input')!;
const select = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click();
const layers = () => { const result: L.Layer[] = []; map.eachLayer(layer => result.push(layer)); return result; };
const overlay = () => layers().find(layer => layer instanceof GoogleLayer)!;
const tiles = () => layers().filter((layer): layer is L.TileLayer => layer instanceof L.TileLayer && layer.options.pane === 'googlePoi');
it('defaults on, separates attribution, and retains tiles during movement', async () => {
  await setup();
  expect(toggle().checked).toBe(true);
  expect(map.getPane('googlePoi')!.style.zIndex).toBe('250');
  expect(map.getPane('googlePoi')!.style.pointerEvents).toBe('none');
  expect(tiles()[0].options).toMatchObject({ minZoom: 13, maxNativeZoom: 18 });
  expect(document.querySelector('.google-poi-attribution')!.textContent).toBe('Google: Google test <copyright>（施設・地名）');
  expect(document.querySelector('.leaflet-control-attribution')!.textContent).toContain('地理院タイル');
  const tile = tiles()[0]; map.fire('movestart');
  expect(map.hasLayer(tile)).toBe(true); expect(document.querySelector('.google-logo')).not.toBeNull();
  map.fire('moveend'); await settle(); expect(tiles()).toEqual([tile]);
  toggle().click();
  expect(tiles()).toHaveLength(0); expect(document.querySelector('.google-logo')).toBeNull();
  expect(document.querySelector('.google-poi-attribution')).toBeNull();
  expect(document.querySelector('.leaflet-control-attribution')!.textContent).toContain('地理院タイル');
});
it('persists OFF and ON and restores them across map creation', async () => {
  await setup(); toggle().click(); expect(localStorage.getItem(GOOGLE_POI_STORAGE_KEY)).toBe('false');
  map.remove(); await setup(); expect(toggle().checked).toBe(false); expect(tiles()).toHaveLength(0);
  toggle().click(); await settle(); expect(localStorage.getItem(GOOGLE_POI_STORAGE_KEY)).toBe('true');
  map.remove(); await setup(); expect(toggle().checked).toBe(true); expect(tiles()).toHaveLength(1);
});
it.each(['Google 道路', 'Google 航空写真', 'Google 地形'])('disables overlay for %s without losing preference', async name => {
  await setup(); select(name); await settle();
  expect(toggle().disabled).toBe(true); expect(toggle().checked).toBe(true);
  expect(document.getElementById('google-poi-hint')!.textContent).toBe('Google背景では不要');
  expect(tiles()).toHaveLength(0); expect(document.querySelectorAll('.google-logo')).toHaveLength(1);
  select('OpenStreetMap'); await settle(); expect(toggle().disabled).toBe(false); expect(tiles()).toHaveLength(1);
  expect(document.querySelector('.leaflet-control-attribution')!.textContent).toContain('OpenStreetMap');
});
it('never starts an overlay session when restoring a Google background', async () => {
  localStorage.setItem('route-builder-background', 'Google 地形'); await setup();
  expect(GoogleSessions.prototype.get).toHaveBeenCalledWith('terrain');
  expect(GoogleSessions.prototype.get).not.toHaveBeenCalledWith('poiOverlay');
});
it('stops all overlay requests below zoom 13 and resumes at 13', async () => {
  await setup(); map.setZoom(12); await settle();
  expect(tiles()).toHaveLength(0); expect(document.querySelector('.google-logo')).toBeNull();
  expect(document.getElementById('google-poi-hint')!.textContent).toBe('ズーム13以上で表示');
  request.mockClear(); vi.mocked(GoogleSessions.prototype.get).mockClear();
  map.fire('moveend'); await vi.advanceTimersByTimeAsync(3601000);
  expect(request).not.toHaveBeenCalled(); expect(GoogleSessions.prototype.get).not.toHaveBeenCalled();
  map.setZoom(13); await settle(); expect(tiles()).toHaveLength(1);
});
it.each(['session', 'viewport', 'tile'])('removes only the overlay on %s failure and allows explicit retry', async failure => {
  await setup(); const background = layers().find(layer => layer instanceof L.TileLayer && layer.options.pane === 'tilePane')!;
  if (failure === 'tile') tiles()[0].fire('tileerror');
  else {
    if (failure === 'session') vi.mocked(GoogleSessions.prototype.get).mockRejectedValueOnce(new Error('Google session HTTP 403'));
    else request.mockResolvedValueOnce(new Response('', { status: 403 }));
    map.fire('moveend'); await settle();
  }
  expect(map.hasLayer(background)).toBe(true); expect(overlay()).toBeUndefined();
  expect(toggle().checked).toBe(false); expect(document.querySelector('.google-poi-attribution')).toBeNull();
  expect(document.querySelector('.google-logo')).toBeNull();
  expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('表示できません'));
  request.mockClear(); map.fire('moveend'); map.setZoom(14); await settle(); expect(request).not.toHaveBeenCalled();
  toggle().click(); await settle(); expect(tiles()).toHaveLength(1);
});
it('omits the control and Google requests without a key', async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', ''); await setup();
  expect(toggle()).toBeNull(); expect(request).not.toHaveBeenCalled(); expect(GoogleSessions.prototype.get).not.toHaveBeenCalled();
});
it('works when preference storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  await setup(); expect(toggle().checked).toBe(true); toggle().click(); expect(tiles()).toHaveLength(0);
});
it('ignores a pending viewport response after switching to a Google background', async () => {
  let finish!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await setup(); select('Google 道路'); await settle();
  finish(new Response(JSON.stringify({ copyright: 'obsolete overlay', maxZoomRects: [
    { north: 90, south: -90, west: -180, east: 180, maxZoom: 18 },
  ] })));
  await settle();
  expect(tiles()).toHaveLength(0); expect(document.querySelector('.google-poi-attribution')).toBeNull();
  expect(document.querySelectorAll('.google-logo')).toHaveLength(1);
  expect(document.body.textContent).not.toContain('obsolete overlay');
});
it('keeps overlay tiles until replacement loads and updates only Google attribution', async () => {
  await setup(); const old = tiles()[0];
  request.mockResolvedValueOnce(new Response(JSON.stringify({ copyright: 'new attribution', maxZoomRects: [
    { north: 90, south: -90, west: -180, east: 180, maxZoom: 17 },
  ] })));
  map.fire('moveend'); await settle();
  expect(tiles()).toHaveLength(2); expect(map.hasLayer(old)).toBe(true);
  const next = tiles().find(tile => tile !== old)!;
  expect(next.options.maxNativeZoom).toBe(17); next.fire('load');
  expect(tiles()).toEqual([next]);
  expect(document.querySelector('.google-poi-attribution')!.textContent).toContain('new attribution');
  expect(document.querySelector('.leaflet-control-attribution')!.textContent).toContain('地理院タイル');
});
it('does not request a session when an overlay layer is added directly below its minimum zoom', async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', ''); await setup(); map.setZoom(12);
  new GoogleLayer('poiOverlay', 'test-key', new GoogleSessions('test-key'), notify, vi.fn()).addTo(map);
  await settle();
  expect(request).not.toHaveBeenCalled(); expect(GoogleSessions.prototype.get).not.toHaveBeenCalled();
});
