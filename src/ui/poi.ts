import L from 'leaflet';
import { CONFIG } from '../config';
import { groupVending, longestSupplyGap } from '../poi';
import type { PoiKind } from '../osm';
import type { Poi } from '../types';

const kinds = Object.keys(CONFIG.poi.categories) as PoiKind[];
const storageKey = 'route-builder-poi-visible';
const exportKey = 'route-builder-poi-gpx';
export function loadPoiExport(): boolean {
  try { return localStorage.getItem(exportKey) !== 'false'; } catch { return true; }
}
export function loadPoiVisibility(): Record<PoiKind, boolean> {
  const on = Object.fromEntries(kinds.map(k => [k, CONFIG.poi.categories[k].on])) as Record<PoiKind, boolean>;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    for (const k of kinds) if (typeof saved?.[k] === 'boolean') on[k] = saved[k];
  } catch { /* Defaults also work when storage is unavailable. */ }
  return on;
}
const glyph = (kind: PoiKind) => `<svg aria-hidden="true"><use href="#p-${kind}"/></svg>`;
function dot(kind: PoiKind) {
  const span = document.createElement('span'); span.className = 'poi-dot';
  span.style.background = CONFIG.poi.categories[kind].color; span.innerHTML = glyph(kind); return span;
}
export function poiPopup(poi: Poi): HTMLElement {
  const el = document.createElement('div'); el.className = 'poi-pop';
  const name = document.createElement('b'); name.textContent = poi.name;
  el.append(name, `${CONFIG.poi.categories[poi.kind].label} · ${(poi.routeDistance / 1000).toFixed(1)} km地点 · ルートから${Math.round(poi.offset)}m`);
  if (poi.hours) el.append(document.createElement('br'), `営業: ${poi.hours}`);
  const link = document.createElement('a');
  link.href = `https://www.google.com/maps/search/?api=1&query=${poi.lat},${poi.lng}`;
  link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Googleマップで確認';
  el.append(document.createElement('br'), link); return el;
}

export function installPoiUI(map: L.Map, onChange: () => void = () => {}) {
  const $ = (id: string) => document.getElementById(id)!;
  // Below overlayPane (400), where the route is drawn, and markerPane (600).
  map.createPane('poiPane').style.zIndex = '350';
  const layer = L.layerGroup().addTo(map), on = loadPoiVisibility();
  const chips = new Map<PoiKind, HTMLButtonElement>();
  let pois: Poi[] = [], length = 0, ready = false, limit = 30;
  let markers = new Map<string, L.Marker>();
  const exportCheck = $('poi-gpx') as HTMLInputElement;
  exportCheck.checked = loadPoiExport();
  exportCheck.onchange = () => {
    try { localStorage.setItem(exportKey, String(exportCheck.checked)); } catch { /* Keep in-memory choice. */ }
  };
  const markerIcon = (poi: Poi) => {
    const small = map.getZoom() < 13, size = small ? 12 : 22;
    return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<div class="poi-marker${small ? ' small' : ''}" style="background:${CONFIG.poi.categories[poi.kind].color}">${glyph(poi.kind)}</div>` });
  };
  function render(notify = true) {
    layer.clearLayers(); markers = new Map();
    const grouped = groupVending(pois), shown = grouped.filter(p => on[p.kind]);
    for (const k of kinds) {
      const button = chips.get(k)!;
      button.setAttribute('aria-pressed', String(on[k]));
      button.querySelector('.count')!.textContent = String(pois.filter(p => p.kind === k).reduce((n, p) => n + p.count, 0));
    }
    const note = $('gap-note'); note.hidden = !ready; note.textContent = '';
    if (ready) {
      const gap = longestSupplyGap(pois, length), km = (gap.to - gap.from) / 1000;
      note.className = `gap-note${km >= CONFIG.poi.gapWarnKm ? '' : ' ok'}`;
      note.textContent = `補給なし最長 ${km.toFixed(1)} km（${(gap.from / 1000).toFixed(1)}〜${(gap.to / 1000).toFixed(1)} km地点）。コンビニ・商店・道の駅の登録データに基づきます。`;
      $('poi-status').textContent = !kinds.some(k => on[k]) ? '表示する種類を選んでください。' : !shown.length ? 'ルート沿いに登録された地物は見つかりませんでした。' : '';
    }
    for (const poi of shown) {
      const marker = L.marker([poi.lat, poi.lng], { pane: 'poiPane', icon: markerIcon(poi), title: poi.name })
        .bindPopup(poiPopup(poi)).addTo(layer);
      markers.set(poi.id, marker);
    }
    const list = $('poi-list'); list.replaceChildren();
    for (const poi of shown.slice(0, limit)) {
      const li = document.createElement('li'), button = document.createElement('button'); button.className = 'row poi-row';
      const copy = document.createElement('span'); copy.className = 'row-copy';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = poi.name;
      const sub = document.createElement('span'); sub.className = 'sub num';
      sub.textContent = `ルートから${Math.round(poi.offset)}m${poi.hours ? ` · ${poi.hours}` : ''}`;
      copy.append(name, sub);
      const val = document.createElement('span'); val.className = 'val num'; val.textContent = `${(poi.routeDistance / 1000).toFixed(1)} km`;
      button.append(dot(poi.kind), copy, val);
      button.onclick = () => { const marker = markers.get(poi.id)!; map.panTo(marker.getLatLng()); marker.openPopup(); };
      li.append(button); list.append(li);
    }
    $('poi-more').hidden = shown.length <= limit;
    if (notify) onChange();
  }
  for (const k of kinds) {
    const button = document.createElement('button'); button.className = 'chip'; button.type = 'button';
    const count = document.createElement('span'); count.className = 'count num';
    button.append(dot(k), CONFIG.poi.categories[k].label, count);
    button.onclick = () => {
      on[k] = !on[k];
      try { localStorage.setItem(storageKey, JSON.stringify(on)); } catch { /* Keep in-memory choice. */ }
      limit = 30; render();
    };
    chips.set(k, button); $('poi-chips').append(button);
  }
  $('poi-more').onclick = () => {
    const previous = limit; limit += 30; render();
    $('poi-list').querySelectorAll<HTMLButtonElement>('button')[previous]?.focus();
  };
  map.on('zoomend', () => {
    for (const poi of groupVending(pois)) markers.get(poi.id)?.setIcon(markerIcon(poi));
  });
  render(false);
  return {
    get chartPois() { return groupVending(pois).filter(p => on[p.kind]); },
    get gap() { return ready ? longestSupplyGap(pois, length) : null; },
    // GPX preserves each original feature, including the machines grouped in the UI.
    get exportPois() { return exportCheck.checked ? pois.filter(p => on[p.kind]) : []; },
    reset(message: string) { pois = []; length = 0; ready = false; limit = 30; render(); $('poi-status').textContent = message; },
    message(message: string) { $('poi-status').textContent = message; },
    set(next: Poi[], routeLength: number) { pois = next; length = routeLength; ready = true; limit = 30; render(); },
  };
}
