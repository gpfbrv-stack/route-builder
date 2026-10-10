import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import './style.css';
import { createMap } from './map';
import { CONFIG, type Profile } from './config';
import { debounce } from './async';
import { Router, joinSegments } from './routing';
import { History } from './state';
import { routeLength, nearestOnRoute, distance } from './geo';
import type { RouteState, Point, Place } from './types';
import { filterPlaces } from './places';
import { OsmProvider } from './osm';
import { preparePois } from './poi';
import { installPoiUI } from './ui/poi';
import { DemProvider } from './dem';
import { elevationStats, sampleRoute, type Sample } from './elevation';
import { drawChart } from './chart';
import { generateGPX, parseGPX, gpxFilename } from './gpx';
import { encodeRoute, consumeSharedRoute, loadRoute, saveRoute } from './persistence';
import { cumulativeDistances } from './geo';
import { installPanel } from './panel';

import { mountUI } from './ui/layout';
import { StatusMessages, type StatusKind } from './ui/status';
import { installPopover } from './ui/popover';
import { icon } from './ui/icons';
import { installRouteDrag } from './ui/route-drag';
mountUI();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = new StatusMessages($('status'));
const map = createMap('map', message => status.set('map', message, message.includes('できません') ? 'warn' : message.includes('中…') ? 'busy' : 'info'));
const closeMenu = installPopover($<HTMLButtonElement>('menu-btn'), $('menu-pop'));
document.querySelectorAll('#menu-pop [data-action]').forEach(button => button.addEventListener('click', () => closeMenu()));
const sheet = installPanel($('panel'), $<HTMLButtonElement>('panel-toggle'));
new ResizeObserver(() => map.invalidateSize()).observe($('map'));
const markers = L.layerGroup().addTo(map);
const casing = L.polyline([], { color: '#ffffff', weight: 11, interactive: false }).addTo(map);
const line = L.polyline([], { color: '#0017c1', weight: 6, className: 'route-line' }).addTo(map);
const setLine = (points: Point[]) => { const ll: L.LatLngExpression[] = points.map(p => [p.lat, p.lng]); casing.setLatLngs(ll); line.setLatLngs(ll); };
const router = new Router();
const dem = new DemProvider();
const osmProvider = new OsmProvider();
const placeMarkers = L.layerGroup().addTo(map);
const poiUI = installPoiUI(map, updateChart);
let places: Place[] = [];
const cursor = L.marker([0, 0], { interactive: false, icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="cursor-dot"></div>' }) });
let samples: Sample[] = [];
let resolvedTrack: Point[] = [];
let segmentShapes: Point[][] = [];
let readyRevision = -1, placesRevision = -1;
function syncExport() { document.querySelectorAll<HTMLButtonElement>('[data-action="export"]').forEach(b => b.disabled = readyRevision !== revision || placesRevision !== revision || resolvedTrack.length < 2); }
function updateChart() { drawChart($('chart'), samples, sample => { if (sample) cursor.setLatLng([sample.lat, sample.lng]).addTo(map); else cursor.remove(); }, places, poiUI.chartPois, poiUI.gap); }
function renderPlaces() {
  placeMarkers.clearLayers(); $('places').replaceChildren();
  places.forEach(place => {
    const elevation = place.ele == null ? '—' : Math.round(place.ele).toLocaleString('ja-JP');
    const label = document.createElement('div'); label.className = 'pass-label';
    const value = document.createElement('b'); value.className = 'num'; value.textContent = `${elevation}m`;
    label.append('▲ ', place.name, value);
    const marker = L.marker([place.lat, place.lng], { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: label }) }).addTo(placeMarkers);
    const item = document.createElement('li'), button = document.createElement('button'); button.className = 'row place-row';
    button.innerHTML = `<span class="pass-ico">▲</span><span class="row-copy"><span class="name"></span><span class="sub num">${(place.routeDistance / 1000).toFixed(1)} km地点 · ルートから${Math.round(place.offset)}m</span></span><span class="val num">${elevation} m</span>`;
    button.querySelector('.name')!.textContent = place.name;
    button.title = `標高出典: ${place.elevationSource}`;
    button.onclick = () => map.panTo(marker.getLatLng()); item.append(button); $('places').append(item);
  });
  updateChart();
}
const findPlaces = debounce(async (points: Point[], version: number) => {
  if (version !== revision || points.length < 2) return;
  $('places-status').textContent = '峠・山を検索中…';
  poiUI.reset('補給・休憩を検索中…');
  const imported = history.value.importedPlaces?.length ? structuredClone(history.value.importedPlaces) : undefined;
  try {
    const result = await osmProvider.get(points, () => version === revision, retrying => {
      if (version !== revision) return;
      const message = retrying ? 'Overpassが混雑中。30秒後に1回だけ再試行します。' : 'Overpassが混雑中。取得を省略しました。';
      status.set('osm', message, 'warn'); $('places-status').textContent = message; poiUI.message(message);
    });
    if (version !== revision) return;
    poiUI.set(preparePois(result.pois), routeLength(points));
    const found = imported ?? filterPlaces(result.places, points);
    for (const place of found) {
      if (version !== revision) return;
      if (place.ele == null) { place.ele = await dem.elevation(place); place.elevationSource = place.ele === null ? 'unknown' : 'DEM'; }
    }
    if (version !== revision) return;
    status.set('osm', ''); places = found; renderPlaces();
    $('places-status').textContent = found.length ? '' : 'ルート近傍に登録された峠・山は見つかりませんでした。';
  } catch (error) {
    if (version !== revision) return;
    const reason = error instanceof Error ? error.message : '';
    places = imported ?? []; renderPlaces();
    $('places-status').textContent = imported ? '' : '峠・山を取得できませんでした。' + reason;
    poiUI.reset('補給・休憩を取得できませんでした。' + reason);
    status.set('osm', 'OSM地物を取得できませんでした。' + reason, 'warn');
  }
  if (version === revision) { placesRevision = version; syncExport(); }
}, CONFIG.places.debounceMs);
const history = new History({ name: '新しいルート', points: [], profile: 'mtb', followRoad: true });
let revision = 0;
function notify(message: string, kind: StatusKind = 'info') { status.set('notice', message, kind); }
function change(next: RouteState, keepTrack = false) {
  if (next.points.length > 200) { notify('経由点は200点までです。', 'warn'); return; }
  history.set(keepTrack ? next : { ...next, importedTrack: undefined, importedPlaces: undefined }); render();
}
function remove(index: number) { change({ ...history.value, points: history.value.points.filter((_, i) => i !== index) }); }
const calculate = debounce(async (version: number) => {
  if (version !== revision) return;
  const state = structuredClone(history.value);
  let points = state.importedTrack ?? state.points;
  let shapes = state.points.slice(1).map((point, i) => [state.points[i], point]);
  if (state.importedTrack) notify('GPXの形状を保持中。経由点・走り方を編集するとルートを再計算します。');
  else if (state.followRoad && points.length > 1) {
    notify('道に沿ったルートを計算中…', 'busy');
    const segments = await router.route(points, state.profile, () => version === revision);
    if (version !== revision) return;
    points = joinSegments(segments);
    shapes = segments.map(segment => segment.points);
    notify(segments.some(s => s.fallback) ? '一部区間を取得できませんでした。該当区間は直線で表示しています。' : 'ルートを更新しました。', segments.some(s => s.fallback) ? 'warn' : 'info');
  } else notify(points.length < 2 ? '地図上に2点以上を置いてください。' : '直線モードで表示しています。');
  setLine(points);
  segmentShapes = state.importedTrack ? [] : shapes;
  $('summary').innerHTML = `${(routeLength(points) / 1000).toFixed(1)}<small>km</small>`;
  findPlaces(points, version);
  if (points.length < 2) { samples = []; renderStats(); status.set('elevation', ''); updateChart(); return; }
  status.set('elevation', '標高を取得中…', 'busy');
  const initial = sampleRoute(points, CONFIG.elevation.intervalM);
  const next = state.importedTrack && initial.every(s => s.ele !== null) ? initial : await dem.sample(initial, () => version === revision);
  if (version !== revision) return;
  samples = next;
  const distances = cumulativeDistances(points);
  let sampleIndex = 0;
  resolvedTrack = points.map((p, i) => {
    while (sampleIndex < samples.length - 2 && samples[sampleIndex + 1].distance < distances[i]) sampleIndex++;
    const a = samples[sampleIndex], b = samples[Math.min(sampleIndex + 1, samples.length - 1)];
    const t = b.distance === a.distance ? 0 : (distances[i] - a.distance) / (b.distance - a.distance);
    return { ...p, ele: Number.isFinite(p.ele) ? p.ele : a.ele === null || b.ele === null ? null : a.ele + (b.ele - a.ele) * t };
  });
  const stats = elevationStats(samples.map(s => s.ele), CONFIG.elevation.hysteresisM);
  const missing = samples.filter(s => s.ele === null).length;
  status.set('elevation', missing ? `標高欠測 ${missing}/${samples.length} 点。統計は取得できた範囲のみです。` : '', 'warn');
  renderStats(stats); updateWaypointMetrics(points);
  updateChart();
  readyRevision = version; syncExport();
}, CONFIG.routing.debounceMs);
function renderStats(stats?: ReturnType<typeof elevationStats>) {
  $('stats').innerHTML = [['登り', stats?.highest == null ? null : stats.ascent], ['下り', stats?.highest == null ? null : stats.descent], ['最高点', stats?.highest]].map(([label, value]) => `<div class="stat"><dt>${label}</dt><dd class="num">${typeof value === 'number' ? Math.round(value).toLocaleString('ja-JP') : '—'}<small>m</small></dd></div>`).join('');
}
function updateWaypointMetrics(track: Point[]) {
  const ends = [0];
  segmentShapes.forEach((shape, i) => ends.push(ends[i] + routeLength(shape) + (i && shape.length && segmentShapes[i - 1].length ? distance(segmentShapes[i - 1].at(-1)!, shape[0]) : 0)));
  history.value.points.forEach((point, i) => {
    // A closed route visits the same coordinate twice. Keep waypoint order.
    const d = segmentShapes.length ? ends[i] : i === 0 ? 0 : i === history.value.points.length - 1 ? routeLength(track) : nearestOnRoute(point, track).routeDistance;
    const sample = samples.reduce<Sample | undefined>((best, s) => !best || Math.abs(s.distance - d) < Math.abs(best.distance - d) ? s : best, undefined);
    const sub = document.querySelector<HTMLElement>(`[data-waypoint="${i}"] .sub`);
    if (sub) sub.textContent = `${(d / 1000).toFixed(1)} km · 標高${sample?.ele == null ? '—' : Math.round(sample.ele).toLocaleString('ja-JP')}m`;
  });
}
function render() {
  routeDrag.cancel(); segmentShapes = [];
  revision++;
  readyRevision = placesRevision = -1; resolvedTrack = []; syncExport();
  $('summary').innerHTML = '—<small>km</small>';
  status.set('notice', '');
  status.set('osm', '');
  status.set('storage', saveRoute(history.value) ? '' : '自動保存できません。GPX保存をご利用ください。', 'warn');
  document.querySelectorAll<HTMLInputElement>('#route-name, #mobile-name').forEach(input => input.value = history.value.name);
  samples = []; updateChart(); renderStats(); status.set('elevation', '');
  places = []; renderPlaces(); $('places-status').textContent = history.value.points.length < 2 ? 'ルートを描くと近くの峠・山を表示します。' : '峠・山を検索待ち…';
  poiUI.reset(history.value.points.length < 2 ? 'ルートを描くと近くの補給・休憩地点を表示します。' : '補給・休憩を検索中…');
  markers.clearLayers();
  $('waypoints').replaceChildren();
  const state = history.value;
  $('point-count').textContent = String(state.points.length);
  document.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.profile === state.profile)));
  document.querySelectorAll<HTMLInputElement>('[data-follow]').forEach(input => input.checked = state.followRoad);
  document.querySelectorAll<HTMLButtonElement>('[data-action="undo"]').forEach(b => b.disabled = !history.canUndo);
  document.querySelectorAll<HTMLButtonElement>('[data-action="clear"]').forEach(b => b.disabled = !state.points.length);
  $('hint').hidden = state.points.length >= 2;
  state.points.forEach((point, i) => {
    const cls = i === 0 ? 'start' : i === state.points.length - 1 ? 'goal' : '', badge = i === 0 ? 'S' : i === state.points.length - 1 ? 'G' : String(i + 1);
    const marker = L.marker([point.lat, point.lng], { draggable: true, title: `経由点 ${i + 1}`, icon: L.divIcon({ className: '', html: `<div class="wp-marker ${cls}">${badge}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(markers);
    marker.on('dragend', () => { const p = marker.getLatLng(); change({ ...history.value, points: history.value.points.map((old, index) => index === i ? { lat: p.lat, lng: p.lng } : old) }); });
    const button = document.createElement('button'); button.textContent = `経由点 ${i + 1} を削除`; button.onclick = () => { remove(i); map.closePopup(); };
    marker.bindPopup(button);
    const item = document.createElement('li'); item.className = 'row'; item.dataset.waypoint = String(i);
    const label = document.createElement('span'); label.className = `wp-badge ${cls}`; label.textContent = badge;
    const focus = document.createElement('button'); focus.className = 'waypoint-focus row-copy';
    focus.innerHTML = `<span class="name">${i === 0 ? 'スタート' : i === state.points.length - 1 ? 'ゴール' : '経由点'}</span><span class="sub num">—</span>`;
    focus.onclick = () => { map.panTo(marker.getLatLng()); marker.openPopup(); };
    const del = document.createElement('button'); del.className = 'icon-btn del'; del.innerHTML = icon('x'); del.setAttribute('aria-label', `経由点 ${i + 1} を削除`); del.onclick = () => remove(i);
    item.append(label, focus, del); $('waypoints').append(item);
  });
  setLine(state.importedTrack ?? state.points);
  calculate(revision);
}
const routeDrag = installRouteDrag(map, line, () => ({ shapes: segmentShapes, points: history.value.points, revision, enabled: !history.value.importedTrack && segmentShapes.length > 0 }), (index, point) => {
  const points = [...history.value.points]; points.splice(index, 0, point); change({ ...history.value, points });
});
map.on('click', (event: L.LeafletMouseEvent) => change({ ...history.value, points: [...history.value.points, { lat: event.latlng.lat, lng: event.latlng.lng }] }));
$('profile').onchange = () => change({ ...history.value, profile: $<HTMLSelectElement>('profile').value as Profile });
$('follow').onchange = () => change({ ...history.value, followRoad: $<HTMLInputElement>('follow').checked });
$('undo').onclick = () => { history.undo(); render(); };
$('clear').onclick = () => change({ ...history.value, points: [] });
$('fit').onclick = () => { if (line.getLatLngs().length) map.fitBounds(line.getBounds(), { paddingTopLeft: [24, 72], paddingBottomRight: [72, matchMedia('(max-width: 767px)').matches ? $('panel').clientHeight + 24 : 88], maxZoom: 16 }); };
document.querySelectorAll<HTMLInputElement>('#route-name, #mobile-name').forEach(input => input.onchange = () => {
  history.value.name = input.value.trim() || '新しいルート';
  document.querySelectorAll<HTMLInputElement>('#route-name, #mobile-name').forEach(other => other.value = history.value.name);
  status.set('storage', saveRoute(history.value) ? '' : '自動保存できません。', 'warn');
});
$('import').onclick = () => $<HTMLInputElement>('file').click();
$('file').onchange = async () => {
  const file = $<HTMLInputElement>('file').files?.[0]; if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('GPXは20MBまでです');
    const imported = parseGPX(await file.text()); change(imported.state, true);
    setLine(imported.track); $('fit').click();
  } catch (error) { notify(error instanceof Error ? error.message : 'GPXを読み込めませんでした', 'warn'); }
  $<HTMLInputElement>('file').value = '';
};
$('export').onclick = () => {
  if (readyRevision !== revision || placesRevision !== revision) return;
  const blob = new Blob([generateGPX(history.value, resolvedTrack, places, poiUI.exportPois)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = gpxFilename(history.value.name); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (resolvedTrack.some(p => p.ele == null)) notify('標高欠測点はeleを省略して保存しました。');
};
$('share').onclick = async () => {
  const url = new URL(location.href); url.hash = encodeRoute(history.value);
  const input = $<HTMLInputElement>('share-url'); input.value = url.href;
  try { await navigator.clipboard.writeText(url.href); input.hidden = true; notify('共有URLをコピーしました。経由点から受信側で再計算します。'); } catch { input.hidden = false; if (matchMedia('(max-width: 767px)').matches) sheet.expand(); input.focus(); input.select(); input.scrollIntoView({ block: 'nearest' }); notify('共有URLを表示しました。選択してコピーしてください。'); }
};
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#route=')) return;
  try { const shared = consumeSharedRoute(); if (shared) { change(shared, true); $('fit').click(); } } catch (error) { notify((error as Error).message, 'warn'); }
});
let startupError = '';
try { history.value = consumeSharedRoute() ?? loadRoute() ?? history.value; } catch (error) { history.value = loadRoute() ?? history.value; startupError = (error as Error).message; }
render();
if (history.value.points.length) $('fit').click();
if (startupError) status.set('storage', startupError, 'warn');
let chartWidth = 0; new ResizeObserver(entries => { const width = entries[0].contentRect.width; if (width !== chartWidth) { chartWidth = width; updateChart(); } }).observe($('chart'));
