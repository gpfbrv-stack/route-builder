import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { createMap } from './map';
import { CONFIG, OSM_ATTRIBUTION, type Profile } from './config';
import { debounce } from './async';
import { Router, joinSegments } from './routing';
import { History } from './state';
import { routeLength } from './geo';
import type { RouteState, Point, Place } from './types';
import { PlaceProvider } from './places';
import { DemProvider } from './dem';
import { elevationStats, sampleRoute, type Sample } from './elevation';
import { drawChart } from './chart';
import { generateGPX, parseGPX, gpxFilename } from './gpx';
import { encodeRoute, decodeRoute, loadRoute, saveRoute } from './persistence';
import { cumulativeDistances } from './geo';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><h1>ルートビルダー</h1><p>自転車で、次の道へ</p></header>
  <div id="toolbar">
    <label>走り方 <select id="profile">${Object.entries(CONFIG.profiles).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('')}</select></label>
    <label><input type="checkbox" id="follow" checked> 道に沿う</label>
    <button id="undo">元に戻す</button><button id="clear">全消去</button><button id="fit">全体表示</button>
    <button id="import">GPX読込</button><input id="file" type="file" accept=".gpx,application/gpx+xml" hidden>
    <button id="export" disabled>GPX保存</button><button id="share">共有URL</button>
  </div>
  <main><div id="map" aria-label="ルート作成地図"></div><aside id="panel">
    <h2>ルートを描く</h2><p>地図をクリックして追加。経由点はドラッグで移動、クリックで削除できます。</p>
    <label>ルート名 <input id="route-name" maxlength="200" value="新しいルート"></label>
    <p id="storage-status" role="status"></p><input id="share-url" aria-label="共有URL" readonly hidden>
    <div id="notice" role="status" aria-live="polite"></div><p id="summary">0.00 km</p>
    <p id="elevation-status" role="status"></p><div id="stats"></div><h2>標高プロファイル</h2><div id="chart"></div>
    <small>標高: 地理院タイル / 登降は5mヒステリシスによる概算</small>
    <h2>通過する峠・山</h2><p id="places-status" role="status"></p><ul id="places"></ul>
    <h2>経由点 <span id="point-count">0</span></h2><ol id="waypoints"></ol>
    <small>ルーティング: BRouter / ${OSM_ATTRIBUTION}</small>
  </aside></main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const map = createMap('map');
const markers = L.layerGroup().addTo(map);
const line = L.polyline([], { color: '#0017c1', weight: 5 }).addTo(map);
const router = new Router();
const dem = new DemProvider();
const placeProvider = new PlaceProvider();
const placeMarkers = L.layerGroup().addTo(map);
let places: Place[] = [];
const cursor = L.circleMarker([0, 0], { radius: 7, color: '#b14c00', fillOpacity: 1 });
let samples: Sample[] = [];
let resolvedTrack: Point[] = [];
let readyRevision = -1, placesRevision = -1;
function syncExport() { $<HTMLButtonElement>('export').disabled = readyRevision !== revision || placesRevision !== revision || resolvedTrack.length < 2; }
function updateChart() { drawChart($('chart'), samples, sample => { if (sample) cursor.setLatLng([sample.lat, sample.lng]).addTo(map); else cursor.remove(); }, places); }
function renderPlaces() {
  placeMarkers.clearLayers(); $('places').replaceChildren();
  places.forEach(place => {
    const elevation = place.ele == null ? '標高不明' : `${Math.round(place.ele)} m`;
    const label = document.createElement('span'); label.textContent = `${place.name} · ${elevation}`;
    const marker = L.circleMarker([place.lat, place.lng], { radius: 5, color: '#115a36', fillOpacity: 1 }).addTo(placeMarkers).bindTooltip(label, { permanent: true, direction: 'top' });
    const item = document.createElement('li'), button = document.createElement('button');
    button.textContent = `${(place.routeDistance / 1000).toFixed(2)} km · ${place.name} · ${elevation}`;
    button.title = `ルートから約${Math.round(place.offset)}m / 標高出典: ${place.elevationSource}`;
    button.onclick = () => map.panTo(marker.getLatLng()); item.append(button); $('places').append(item);
  });
  updateChart();
}
const findPlaces = debounce(async (points: Point[], version: number) => {
  if (version !== revision || points.length < 2) return;
  $('places-status').textContent = '峠・山を検索中…';
  try {
    const found = history.value.importedPlaces?.length ? structuredClone(history.value.importedPlaces) : await placeProvider.get(points, () => version === revision);
    for (const place of found) {
      if (version !== revision) return;
      if (place.ele == null) { place.ele = await dem.elevation(place); place.elevationSource = place.ele === null ? 'unknown' : 'DEM'; }
    }
    if (version !== revision) return;
    places = found; renderPlaces();
    $('places-status').textContent = found.length ? `${found.length}件（OSM登録地物、近接判定）` : 'ルート近傍に登録された峠・山は見つかりませんでした。';
  } catch (error) {
    if (version !== revision) return;
    places = []; renderPlaces(); $('places-status').textContent = `峠・山を取得できませんでした。${error instanceof Error ? error.message : ''}`;
  }
  if (version === revision) { placesRevision = version; syncExport(); }
}, CONFIG.places.debounceMs);
const history = new History({ name: '新しいルート', points: [], profile: 'mtb', followRoad: true });
let revision = 0;
function notify(message: string) { $('notice').textContent = message; }
function change(next: RouteState, keepTrack = false) {
  if (next.points.length > 200) { notify('経由点は200点までです。'); return; }
  history.set(keepTrack ? next : { ...next, importedTrack: undefined, importedPlaces: undefined }); render();
}
function remove(index: number) { change({ ...history.value, points: history.value.points.filter((_, i) => i !== index) }); }
const calculate = debounce(async (version: number) => {
  if (version !== revision) return;
  const state = structuredClone(history.value);
  let points = state.importedTrack ?? state.points;
  if (state.importedTrack) notify('GPXの形状を保持中。経由点・走り方を編集するとルートを再計算します。');
  else if (state.followRoad && points.length > 1) {
    notify('道に沿ったルートを計算中…');
    const segments = await router.route(points, state.profile, () => version === revision);
    if (version !== revision) return;
    points = joinSegments(segments);
    notify(segments.some(s => s.fallback) ? '一部区間を取得できませんでした。該当区間は直線で表示しています。' : 'ルートを更新しました。');
  } else notify(points.length < 2 ? '地図上に2点以上を置いてください。' : '直線モードで表示しています。');
  line.setLatLngs(points.map(p => [p.lat, p.lng]));
  $('summary').textContent = `${(routeLength(points) / 1000).toFixed(2)} km`;
  findPlaces(points, version);
  if (points.length < 2) { samples = []; $('stats').textContent = ''; $('elevation-status').textContent = ''; updateChart(); return; }
  $('elevation-status').textContent = '標高を取得中…';
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
  $('elevation-status').textContent = missing ? `標高欠測 ${missing}/${samples.length} 点。統計は取得できた範囲のみです。` : '';
  $('stats').textContent = `登り ${Math.round(stats.ascent)} m / 下り ${Math.round(stats.descent)} m / 最高点 ${stats.highest === null ? '—' : Math.round(stats.highest) + ' m'}`;
  updateChart();
  readyRevision = version; syncExport();
}, CONFIG.routing.debounceMs);
function render() {
  revision++;
  readyRevision = placesRevision = -1; resolvedTrack = []; syncExport();
  $('storage-status').textContent = saveRoute(history.value) ? '' : '自動保存できません。GPX保存をご利用ください。';
  $<HTMLInputElement>('route-name').value = history.value.name;
  samples = []; updateChart(); $('stats').textContent = ''; $('elevation-status').textContent = '';
  places = []; renderPlaces(); $('places-status').textContent = '';
  markers.clearLayers();
  $('waypoints').replaceChildren();
  const state = history.value;
  $('point-count').textContent = String(state.points.length);
  $<HTMLSelectElement>('profile').value = state.profile;
  $<HTMLInputElement>('follow').checked = state.followRoad;
  $<HTMLButtonElement>('undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('clear').disabled = !state.points.length;
  state.points.forEach((point, i) => {
    const marker = L.marker([point.lat, point.lng], { draggable: true, title: `経由点 ${i + 1}`, icon: L.divIcon({ className: 'waypoint', html: String(i + 1), iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(markers);
    marker.on('dragend', () => { const p = marker.getLatLng(); change({ ...history.value, points: history.value.points.map((old, index) => index === i ? { lat: p.lat, lng: p.lng } : old) }); });
    const button = document.createElement('button'); button.textContent = `経由点 ${i + 1} を削除`; button.onclick = () => { remove(i); map.closePopup(); };
    marker.bindPopup(button);
    const item = document.createElement('li');
    const focus = document.createElement('button'); focus.textContent = `${i + 1} · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`; focus.onclick = () => { map.panTo(marker.getLatLng()); marker.openPopup(); };
    const del = document.createElement('button'); del.textContent = '削除'; del.setAttribute('aria-label', `経由点 ${i + 1} を削除`); del.onclick = () => remove(i);
    item.append(focus, del); $('waypoints').append(item);
  });
  line.setLatLngs(state.points.map(p => [p.lat, p.lng]));
  calculate(revision);
}
map.on('click', (event: L.LeafletMouseEvent) => change({ ...history.value, points: [...history.value.points, { lat: event.latlng.lat, lng: event.latlng.lng }] }));
$('profile').onchange = () => change({ ...history.value, profile: $<HTMLSelectElement>('profile').value as Profile });
$('follow').onchange = () => change({ ...history.value, followRoad: $<HTMLInputElement>('follow').checked });
$('undo').onclick = () => { history.undo(); render(); };
$('clear').onclick = () => change({ ...history.value, points: [] });
$('fit').onclick = () => { if (line.getLatLngs().length) map.fitBounds(line.getBounds(), { padding: [32, 32], maxZoom: 16 }); };
$('route-name').onchange = () => { history.value.name = $<HTMLInputElement>('route-name').value.trim() || '新しいルート'; $('storage-status').textContent = saveRoute(history.value) ? '' : '自動保存できません。'; };
$('import').onclick = () => $<HTMLInputElement>('file').click();
$('file').onchange = async () => {
  const file = $<HTMLInputElement>('file').files?.[0]; if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('GPXは20MBまでです');
    const imported = parseGPX(await file.text()); change(imported.state, true);
    line.setLatLngs(imported.track.map(p => [p.lat, p.lng])); $('fit').click();
  } catch (error) { notify(error instanceof Error ? error.message : 'GPXを読み込めませんでした'); }
  $<HTMLInputElement>('file').value = '';
};
$('export').onclick = () => {
  if (readyRevision !== revision || placesRevision !== revision) return;
  const blob = new Blob([generateGPX(history.value, resolvedTrack, places)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = gpxFilename(history.value.name); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (resolvedTrack.some(p => p.ele == null)) notify('標高欠測点はeleを省略して保存しました。');
};
$('share').onclick = async () => {
  const url = new URL(location.href); url.hash = encodeRoute(history.value);
  const input = $<HTMLInputElement>('share-url'); input.hidden = false; input.value = url.href; input.select();
  try { await navigator.clipboard.writeText(url.href); notify('共有URLをコピーしました。経由点から受信側で再計算します。'); } catch { notify('共有URLを表示しました。選択してコピーしてください。'); }
};
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#route=')) return;
  try { change(decodeRoute(location.hash), true); $('fit').click(); } catch (error) { notify((error as Error).message); }
});
let startupError = '';
try { history.value = location.hash.startsWith('#route=') ? decodeRoute(location.hash) : loadRoute() ?? history.value; } catch (error) { startupError = (error as Error).message; }
render();
if (history.value.points.length) $('fit').click();
if (startupError) $('storage-status').textContent = startupError;
