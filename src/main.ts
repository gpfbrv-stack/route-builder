import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { createMap } from './map';
import { CONFIG, OSM_ATTRIBUTION, type Profile } from './config';
import { debounce } from './async';
import { Router, joinSegments } from './routing';
import { History } from './state';
import { routeLength } from './geo';
import type { RouteState } from './types';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><h1>ルートビルダー</h1><p>自転車で、次の道へ</p></header>
  <div id="toolbar">
    <label>走り方 <select id="profile">${Object.entries(CONFIG.profiles).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('')}</select></label>
    <label><input type="checkbox" id="follow" checked> 道に沿う</label>
    <button id="undo">元に戻す</button><button id="clear">全消去</button><button id="fit">全体表示</button>
  </div>
  <main><div id="map" aria-label="ルート作成地図"></div><aside id="panel">
    <h2>ルートを描く</h2><p>地図をクリックして追加。経由点はドラッグで移動、クリックで削除できます。</p>
    <div id="notice" role="status" aria-live="polite"></div><p id="summary">0.00 km</p>
    <h2>経由点 <span id="point-count">0</span></h2><ol id="waypoints"></ol>
    <small>ルーティング: BRouter / ${OSM_ATTRIBUTION}</small>
  </aside></main>`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const map = createMap('map');
const markers = L.layerGroup().addTo(map);
const line = L.polyline([], { color: '#0017c1', weight: 5 }).addTo(map);
const router = new Router();
const history = new History({ name: '新しいルート', points: [], profile: 'mtb', followRoad: true });
let revision = 0;
function notify(message: string) { $('notice').textContent = message; }
function change(next: RouteState) { history.set(next); render(); }
function remove(index: number) { change({ ...history.value, points: history.value.points.filter((_, i) => i !== index) }); }
const calculate = debounce(async (version: number) => {
  if (version !== revision) return;
  const state = structuredClone(history.value);
  let points = state.points;
  if (state.followRoad && points.length > 1) {
    notify('道に沿ったルートを計算中…');
    const segments = await router.route(points, state.profile, () => version === revision);
    if (version !== revision) return;
    points = joinSegments(segments);
    notify(segments.some(s => s.fallback) ? '一部区間を取得できませんでした。該当区間は直線で表示しています。' : 'ルートを更新しました。');
  } else notify(points.length < 2 ? '地図上に2点以上を置いてください。' : '直線モードで表示しています。');
  line.setLatLngs(points.map(p => [p.lat, p.lng]));
  $('summary').textContent = `${(routeLength(points) / 1000).toFixed(2)} km`;
}, CONFIG.routing.debounceMs);
function render() {
  revision++;
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
render();
