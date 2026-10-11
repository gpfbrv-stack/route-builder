import L from 'leaflet';
import { BASE_LAYERS } from './config';
import { addGoogleLayers } from './google-layer';
import { installPopover } from './ui/popover';
import { installGooglePoi } from './ui/google-poi';

export function createMap(element: string, notify: (message: string) => void = () => {}) {
  const map = L.map(element, { zoomControl: false, doubleClickZoom: false }).setView([35.1615, 135.7590], 13);
  L.control.scale({ imperial: false }).addTo(map);
  const layers: Record<string, L.Layer> = Object.fromEntries(BASE_LAYERS.map(config => [config.name, L.tileLayer(config.url, { maxZoom: 19, maxNativeZoom: config.maxNativeZoom, attribution: config.attribution })]));
  let current: L.Layer | undefined;
  let googlePoi: ReturnType<typeof installGooglePoi> | undefined;
  const buttons = new Map<string, HTMLButtonElement>();
  const select = (name: string) => {
    if (!layers[name]) return;
    current?.remove(); current = layers[name];
    googlePoi?.setBackground(name.startsWith('Google'));
    current.addTo(map);
    buttons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === name)));
    try { localStorage.setItem('route-builder-background', name); } catch { /* Selection works without storage. */ }
  };
  Object.assign(layers, addGoogleLayers(() => select('地理院 淡色'), notify));
  const pop = document.getElementById('layer-pop')!;
  const group = (title: string, names: string[]) => {
    if (!names.length) return;
    const heading = document.createElement('h3'); heading.textContent = title;
    const grid = document.createElement('div'); grid.className = 'layer-grid';
    names.forEach(name => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', name); button.setAttribute('aria-pressed', 'false');
      const thumb = document.createElement('span'); thumb.className = 'thumb'; thumb.setAttribute('aria-hidden', 'true');
      const config = BASE_LAYERS.find(c => c.name === name);
      if (config) thumb.style.backgroundImage = `url(${config.url.replace('{z}', '12').replace('{x}', '3589').replace('{y}', '1612')})`;
      else thumb.style.background = name.includes('航空') ? '#3b4a3a' : name.includes('地形') ? '#cfd8c4' : '#e8eaed';
      button.append(thumb, name.replace(/^(地理院|Google) /, '').replace('OpenStreetMap', 'OSM'));
      button.onclick = () => select(name); buttons.set(name, button); grid.append(button);
    }); pop.append(heading, grid);
  };
  group('地理院', ['地理院 淡色', '地理院 標準', '地理院 写真', '地理院 陰影起伏']);
  group('その他', ['OpenStreetMap']); group('Google', Object.keys(layers).filter(n => n.startsWith('Google')));
  googlePoi = installGooglePoi(map, pop, notify);
  installPopover(document.getElementById('layer-btn') as HTMLButtonElement, pop);
  let saved = ''; try { saved = localStorage.getItem('route-builder-background') ?? ''; } catch { /* Default below. */ }
  select(layers[saved] ? saved : '地理院 淡色');
  document.querySelectorAll<HTMLElement>('.map-ui').forEach(ui => { L.DomEvent.disableClickPropagation(ui); L.DomEvent.disableScrollPropagation(ui); });
  document.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')!.onclick = () => map.zoomIn();
  document.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')!.onclick = () => map.zoomOut();
  let location: L.CircleMarker | undefined;
  const locate = document.querySelector<HTMLButtonElement>('[data-action="locate"]')!;
  locate.onclick = () => {
    if (!navigator.geolocation) { notify('現在地を取得できません。'); return; }
    locate.disabled = true; notify('現在地を取得中…');
    navigator.geolocation.getCurrentPosition(position => {
      locate.disabled = false; const ll: L.LatLngExpression = [position.coords.latitude, position.coords.longitude];
      location?.remove(); location = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: '#0017c1', fillOpacity: 1, interactive: false }).addTo(map);
      map.setView(ll, 16); notify('現在地を表示しました。');
    }, () => { locate.disabled = false; notify('現在地を取得できません。位置情報の許可・接続を確認してください。'); }, { timeout: 15000 });
  };
  return map;
}
