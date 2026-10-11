import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import './style.css';
import { createMap } from './map';
import { CONFIG, GSI_ATTRIBUTION, type Profile } from './config';
import { debounce } from './async';
import { Router, joinSegments, routingWarnings } from './routing';
import { History, insertWaypoint, removeWaypoint, selectProfile, selectMode, defaultLegMode, reprofile } from './state';
import { routeLength, nearestOnRoute, distance } from './geo';
import { LEG_MODE_LABELS, type LegMode, type RouteState, type Point, type Place } from './types';
import { filterPlaces, progressivePlaces } from './places';
import { GsiPlaceProvider } from './gsi-places';
import { OsmProvider } from './osm';
import { preparePois } from './poi';
import { installPoiUI } from './ui/poi';
import { DemProvider } from './dem';
import { elevationStats, sampleRoute, type Sample } from './elevation';
import { drawChart } from './chart';
import { surfaceSpans, surfaceSummary, unknownSurface, type SurfaceSpan } from './surface';
import { installChartMode } from './ui/chart-mode';
import { generateGPX, parseGPX, gpxFilename } from './gpx';
import { detectImportFormat, extractKmz, MAX_PIN_BYTES, parseKml, parsePinGeoJson } from './pins';
import { installPinsUI } from './ui/pins';
import { encodeRoute, consumeSharedRoute, loadRoute, saveRoute } from './persistence';
import { cumulativeDistances } from './geo';
import { installPanel } from './panel';

import { mountUI } from './ui/layout';
import { StatusMessages, type StatusKind } from './ui/status';
import { installPopover } from './ui/popover';
import { icon } from './ui/icons';
import { installRouteDrag } from './ui/route-drag';
import { RouteLine } from './ui/route-line';
import { RoutePreview } from './ui/route-preview';
import { GsiUsage } from './ui/gsi-usage';
import { DetourSuggestions } from './ui/detours';
import { installGarminDialog, sendGarminCourse, preloadFit } from './ui/garmin';
mountUI();
const showGarminInstructions = installGarminDialog();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = new StatusMessages($('status'));
const map = createMap('map', message => status.set('map', message, message.includes('できません') ? 'warn' : message.includes('中…') ? 'busy' : 'info'));
const closeMenu = installPopover($<HTMLButtonElement>('menu-btn'), $('menu-pop'));
document.querySelectorAll('#menu-pop [data-action]').forEach(button => button.addEventListener('click', () => closeMenu()));
const sheet = installPanel($('panel'), $<HTMLButtonElement>('panel-toggle'));
new ResizeObserver(() => map.invalidateSize()).observe($('map'));
const markers = L.layerGroup().addTo(map);
const router = new Router();
const gsiUsage = new GsiUsage(map.attributionControl, message => status.set('gsi', message, 'info'));
const routeLine = new RouteLine(map, router);
const line = routeLine.hit;
const livePreview = new RoutePreview(router, state => routeLine.update(state), (index, segment) => routeLine.resolve(index, segment));
const dem = new DemProvider();
const osmProvider = new OsmProvider();
const gsiPlaces = new GsiPlaceProvider(point => dem.elevation(point));
map.attributionControl.addAttribution(`地名: ${GSI_ATTRIBUTION}`);
const placeMarkers = L.layerGroup().addTo(map);
const poiUI = installPoiUI(map, updateChart);
let places: Place[] = [];
const cursor = L.marker([0, 0], { interactive: false, icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="cursor-dot"></div>' }) });
let samples: Sample[] = [];
let surfaces: SurfaceSpan[] = [];
const chartMode = installChartMode(document, updateChart);
let resolvedTrack: Point[] = [];
let segmentShapes: Point[][] = [];
let readyRevision = -1, placesRevision = -1;
let garminBusy = false;
function syncExport() {
  document.querySelectorAll<HTMLButtonElement>('[data-action="export"], [data-action="garmin"]').forEach(b => b.disabled = readyRevision !== revision || placesRevision !== revision || resolvedTrack.length < 2 || (b.dataset.action === 'garmin' && garminBusy));
  if (readyRevision === revision && resolvedTrack.length >= 2) void preloadFit();
}
function updateChart() { drawChart($('chart'), samples, sample => { if (sample) cursor.setLatLng([sample.lat, sample.lng]).addTo(map); else cursor.remove(); }, places, poiUI.chartPois, poiUI.gap, chartMode.mode, surfaces); }
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
  const current = () => version === revision;
  const errors: string[] = [];
  const publish = (found: Place[]) => {
    places = imported ?? found; renderPlaces();
    $('places-status').textContent = places.length ? '' : errors.join(' ') || 'ルート近傍に登録された峠・山は見つかりませんでした。';
  };
  const gsi = gsiPlaces.get(points, current).catch(error => {
    if (current()) errors.push(error instanceof Error ? error.message : '地理院注記を取得できませんでした。');
    return [];
  }).then(async found => {
    for (const place of imported ?? []) {
      if (!current()) return [];
      if (place.ele == null) { place.ele = await dem.elevation(place); place.elevationSource = place.ele === null ? 'unknown' : 'DEM'; }
    }
    return found;
  });
  const osm = (async () => {
    try {
      const result = await osmProvider.get(points, current, retrying => {
        if (!current()) return;
        const message = retrying ? 'Overpassが混雑中。30秒後に1回だけ再試行します。' : 'Overpassが混雑中。取得を省略しました。';
        status.set('osm', message, 'warn'); poiUI.message(message);
      });
      if (!current()) return [];
      poiUI.set(preparePois(result.pois), routeLength(points));
      const found = filterPlaces(result.places, points);
      for (const place of found) {
        if (!current()) return [];
        if (place.ele == null) { place.ele = await dem.elevation(place); place.elevationSource = place.ele === null ? 'unknown' : 'DEM'; }
      }
      if (current()) status.set('osm', '');
      return found;
    } catch (error) {
      if (!current()) return [];
      const reason = error instanceof Error ? error.message : '';
      errors.push('OSM地物を取得できませんでした。' + reason);
      poiUI.reset('補給・休憩を取得できませんでした。' + reason);
      status.set('osm', errors.at(-1)!, 'warn');
      return [];
    }
  })();
  await progressivePlaces(gsi, osm, publish, current);
  if (version === revision) { placesRevision = version; syncExport(); }
}, CONFIG.places.debounceMs);
const history = new History({ name: '新しいルート', points: [], profile: 'mtb', legProfiles: [], legMode: [], mode: defaultLegMode('mtb') });
const detours = new DetourSuggestions(router, status, $('waypoints'), () => history.value, change);
let revision = 0;
function notify(message: string, kind: StatusKind = 'info') { status.set('notice', message, kind); }
function change(next: RouteState, keepTrack = false) {
  if (next.points.length > 200) { notify('経由点は200点までです。', 'warn'); return; }
  history.set(keepTrack ? next : { ...next, importedTrack: undefined, importedPlaces: undefined }); render();
}
function remove(index: number) { change(removeWaypoint(history.value, index)); }
const calculate = debounce(async (version: number) => {
  if (version !== revision) return;
  const state = structuredClone(history.value);
  const detourCurrent = detours.current();
  let points = state.importedTrack ?? state.points;
  let shapes = state.points.slice(1).map((point, i) => [state.points[i], point]);
  if (state.importedTrack) notify('GPXの形状を保持中。経由点の編集・区間の引き直しでルートを再計算します。');
  else if (state.legMode.some(mode => mode !== 'straight') && points.length > 1) {
    notify('ルートを計算中…', 'busy');
    const segments = await router.route(points, state.legProfiles, () => version === revision, (index, segment) => {
      routeLine.resolveState(state, index, segment);
    }, state.legMode);
    if (version !== revision) return;
    points = joinSegments(segments);
    shapes = segments.map(segment => segment.points);
    const warnings = routingWarnings(segments, state.legProfiles);
    notify(warnings.join(' ') || 'ルートを更新しました。', warnings.length ? 'warn' : 'info');
    gsiUsage.update(state.legMode.includes('gsi') || segments.some(segment => segment.gsi));
    void detours.scan(state, segments, detourCurrent);
  } else notify(points.length < 2 ? '地図上に2点以上を置いてください。' : '直線モードで表示しています。');
  if (state.importedTrack || !state.legMode.some(mode => mode !== 'straight')) gsiUsage.update(state.legMode.includes('gsi'));
  segmentShapes = state.importedTrack ? [] : shapes;
  surfaces = surfaceSpans(state.importedTrack || !state.legMode.some(mode => mode !== 'straight') ? unknownSurface(points) : points);
  $('surface-summary').textContent = surfaceSummary(surfaces);
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
  detours.clear();
  routeDrag.cancel(); livePreview.cancel(); segmentShapes = [];
  revision++;
  readyRevision = placesRevision = -1; resolvedTrack = []; syncExport();
  $('summary').innerHTML = '—<small>km</small>';
  surfaces = []; $('surface-summary').textContent = '';
  status.set('notice', '');
  status.set('gsi', '');
  status.set('osm', '');
  status.set('storage', saveRoute(history.value) ? '' : '自動保存できません。GPX保存をご利用ください。', 'warn');
  document.querySelectorAll<HTMLInputElement>('#route-name, #mobile-name').forEach(input => input.value = history.value.name);
  samples = []; updateChart(); renderStats(); status.set('elevation', '');
  places = []; renderPlaces(); $('places-status').textContent = history.value.points.length < 2 ? 'ルートを描くと近くの峠・山を表示します。' : '峠・山を検索待ち…';
  poiUI.reset(history.value.points.length < 2 ? 'ルートを描くと近くの補給・休憩地点を表示します。' : '補給・休憩を検索中…');
  markers.clearLayers();
  $('waypoints').replaceChildren();
  const state = history.value;
  // Remove stale attribution immediately when clearing or redrawing the route.
  if (!state.legMode.includes('gsi')) gsiUsage.update(state.points.slice(1).some((b, i) => router.cached(state.points[i], b, state.legProfiles[i], state.legMode[i])?.gsi));
  $('point-count').textContent = String(state.points.length);
  document.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.profile === state.profile)));
  syncMode(state.mode);
  document.querySelectorAll<HTMLButtonElement>('[data-action="undo"]').forEach(b => b.disabled = !history.canUndo);
  document.querySelectorAll<HTMLButtonElement>('[data-action="clear"]').forEach(b => b.disabled = !state.points.length);
  document.querySelectorAll<HTMLButtonElement>('[data-action="reprofile-all"]').forEach(b => b.disabled = state.points.length < 2);
  $<HTMLSelectElement>('profile').value = state.profile;
  $('hint').hidden = state.points.length >= 2;
  state.points.forEach((point, i) => {
    const cls = i === 0 ? 'start' : i === state.points.length - 1 ? 'goal' : '', badge = i === 0 ? 'S' : i === state.points.length - 1 ? 'G' : String(i + 1);
    const marker = L.marker([point.lat, point.lng], { draggable: true, title: `経由点 ${i + 1}`, icon: L.divIcon({ className: '', html: `<div class="wp-marker ${cls}">${badge}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(markers);
    const markerRevision = revision;
    const movedState = () => {
      const p = marker.getLatLng();
      return { ...history.value, importedTrack: undefined, importedPlaces: undefined,
        points: history.value.points.map((old, index) => index === i ? { lat: p.lat, lng: p.lng } : old) };
    };
    marker.on('drag', () => { if (markerRevision === revision) livePreview.update(movedState(), i); });
    marker.on('dragend', () => { if (markerRevision === revision) change(movedState()); });
    const button = document.createElement('button'); button.textContent = `経由点 ${i + 1} を削除`; button.onclick = () => { remove(i); map.closePopup(); };
    const popup = document.createElement('div'); popup.className = 'waypoint-popup'; popup.append(button);
    if (i < state.legProfiles.length) {
      const description = document.createElement('span');
      description.textContent = `次の経由点まで: ${state.legMode[i] === 'road' ? CONFIG.profiles[state.legProfiles[i]].label : state.legMode[i] === 'gsi' ? '地理院' : '直線'}`;
      const redraw = document.createElement('button'); redraw.textContent = 'この区間を現在の設定で引き直す';
      redraw.onclick = () => { change(reprofile(history.value, i)); map.closePopup(); };
      popup.append(description, redraw);
    }
    marker.bindPopup(popup);
    const item = document.createElement('li'); item.className = 'row'; item.dataset.waypoint = String(i);
    const label = document.createElement('span'); label.className = `wp-badge ${cls}`; label.textContent = badge;
    const focus = document.createElement('button'); focus.className = 'waypoint-focus row-copy';
    focus.innerHTML = `<span class="name">${i === 0 ? 'スタート' : i === state.points.length - 1 ? 'ゴール' : '経由点'}</span><span class="sub num">—</span>`;
    if (i < state.legProfiles.length) {
      const profile = document.createElement('span'); profile.className = 'sub leg-profile';
      profile.textContent = `次の経由点まで: ${state.legMode[i] === 'road' ? CONFIG.profiles[state.legProfiles[i]].label : state.legMode[i] === 'gsi' ? '地理院' : '直線'}`;
      focus.append(profile);
    }
    focus.onclick = () => { map.panTo(marker.getLatLng()); marker.openPopup(); };
    const del = document.createElement('button'); del.className = 'icon-btn del'; del.innerHTML = icon('x'); del.setAttribute('aria-label', `経由点 ${i + 1} を削除`); del.onclick = () => remove(i);
    const menu = document.createElement('details'); menu.className = 'waypoint-menu';
    const toggle = document.createElement('summary'); toggle.textContent = '…'; toggle.setAttribute('aria-label', `経由点 ${i + 1} のメニュー`);
    const actions = document.createElement('div'); actions.className = 'waypoint-actions';
    if (i < state.legProfiles.length) {
      const redraw = document.createElement('button'); redraw.textContent = 'この区間を現在の設定で引き直す';
      redraw.onclick = () => change(reprofile(history.value, i)); actions.append(redraw);
    }
    actions.append(del); menu.append(toggle, actions);
    menu.addEventListener('keydown', e => { if (e.key === 'Escape') { menu.open = false; toggle.focus(); } });
    item.append(label, focus, menu); $('waypoints').append(item);
  });
  routeLine.update(state);
  calculate(revision);
}
const routeDrag = installRouteDrag(map, line, () => ({ shapes: routeLine.shapes, points: history.value.points, revision, enabled: !history.value.importedTrack && routeLine.shapes.length > 0 }), (index, point) => {
  change(insertWaypoint(history.value, index, point));
}, {
  update: (index, point) => livePreview.update(insertWaypoint(history.value, index, point), index),
  cancel: () => { livePreview.cancel(); routeLine.update(history.value); },
});
map.on('click', (event: L.LeafletMouseEvent) => change(insertWaypoint(history.value, history.value.points.length, { lat: event.latlng.lat, lng: event.latlng.lng })));
$('profile').onchange = () => {
  detours.clear();
  const profile = $<HTMLSelectElement>('profile').value as Profile;
  history.value = selectProfile(history.value, profile);
  syncMode(history.value.mode);
  document.querySelectorAll<HTMLButtonElement>('[data-profile]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.profile === profile)));
  status.set('storage', saveRoute(history.value) ? '' : '自動保存できません。', 'warn');
  notify(`これから引く区間を${CONFIG.profiles[profile].label}で計算します`);
};
$('reprofile-all').onclick = () => { if (history.value.legProfiles.length) change(reprofile(history.value)); };
function syncMode(mode: LegMode) {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.onclick = () => {
  detours.clear();
  const mode = button.dataset.mode as LegMode;
  history.value = selectMode(history.value, mode);
  syncMode(mode);
  status.set('storage', saveRoute(history.value) ? '' : '自動保存できません。', 'warn');
  notify(`これから引く区間を${LEG_MODE_LABELS[mode]}で引きます`);
});
$('undo').onclick = () => { history.undo(); render(); };
$('clear').onclick = () => change({ ...history.value, points: [], legProfiles: [], legMode: [] });
$('fit').onclick = () => { if (line.getLatLngs().length) map.fitBounds(line.getBounds(), { paddingTopLeft: [24, 72], paddingBottomRight: [72, matchMedia('(max-width: 767px)').matches ? $('panel').clientHeight + 24 : 88], maxZoom: 16 }); };
document.querySelectorAll<HTMLInputElement>('#route-name, #mobile-name').forEach(input => input.onchange = () => {
  detours.clear();
  history.value.name = input.value.trim() || '新しいルート';
  document.querySelectorAll<HTMLInputElement>('#route-name, #mobile-name').forEach(other => other.value = history.value.name);
  status.set('storage', saveRoute(history.value) ? '' : '自動保存できません。', 'warn');
});
$('import').onclick = () => $<HTMLInputElement>('file').click();
const pinsUI = installPinsUI(map, point => change(insertWaypoint(history.value, history.value.points.length, point)),
  message => status.set('pin-storage', message, 'warn'));
$('file').onchange = async () => {
  const file = $<HTMLInputElement>('file').files?.[0]; if (!file) return;
  try {
    if (file.size > MAX_PIN_BYTES) throw new Error('ファイルは20MBまでです');
    const content = /\.kmz$/i.test(file.name) ? new Uint8Array(await file.arrayBuffer()) : await file.text();
    const format = detectImportFormat(file.name, content);
    const textContent = typeof content === 'string' ? content : format === 'kmz' ? '' : new TextDecoder().decode(content);
    if (format === 'gpx') {
      const imported = parseGPX(textContent, history.value.profile, history.value.mode); change(imported.state, true);
      $('fit').click();
    } else {
      const imported = format === 'geojson' ? parsePinGeoJson(textContent)
        : parseKml(format === 'kmz' ? await extractKmz(content instanceof Uint8Array ? content : new Uint8Array(await file.arrayBuffer())) : textContent);
      pinsUI.import(file.name, imported.pins);
      notify(`ピンを${imported.pins.length}件読み込みました(${imported.skipped}件はスキップ)`);
    }
  } catch (error) { notify(error instanceof Error ? error.message : 'ファイルを読み込めませんでした', 'warn'); }
  $<HTMLInputElement>('file').value = '';
};
$('export').onclick = () => {
  if (readyRevision !== revision || placesRevision !== revision) return;
  const blob = new Blob([generateGPX(history.value, resolvedTrack, places, poiUI.exportPois)], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = gpxFilename(history.value.name); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (resolvedTrack.some(p => p.ele == null)) notify('標高欠測点はeleを省略して保存しました。');
};
$('garmin').onclick = async () => {
  if (garminBusy || readyRevision !== revision || placesRevision !== revision || resolvedTrack.length < 2) return;
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  garminBusy = true; syncExport();
  try {
    await sendGarminCourse({ name: history.value.name, profile: history.value.profile,
      legs: history.value.legProfiles.map((profile, i) => ({ profile,
        distance: segmentShapes[i] ? routeLength(segmentShapes[i]) : i === 0 ? routeLength(resolvedTrack) : 0 })).filter((_, i) => history.value.legMode[i] === 'road'),
      resolvedTrack, places, pois: poiUI.fitPois }, () => showGarminInstructions(trigger));
  } catch (error) { notify(`FITを送信・保存できませんでした。${error instanceof Error ? error.message : ''}`, 'warn'); }
  finally {
    garminBusy = false; syncExport();
    if (!$<HTMLDialogElement>('garmin-dialog').open && document.activeElement === document.body) trigger?.focus();
  }
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
