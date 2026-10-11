import L from 'leaflet';
import { deletePinSource, loadPins, replacePinSource, safeGoogleMapsUrl, savePins, type Pin, type PinSource } from '../pins';

export function pinPopup(pin: Pin, source: string, addWaypoint: (point: { lat: number; lng: number }) => void): HTMLElement {
  const popup = document.createElement('div'); popup.className = 'pin-popup';
  const name = document.createElement('b'); name.textContent = pin.name; popup.append(name);
  for (const value of [pin.address, pin.description?.slice(0, 300), pin.folder, source]) {
    if (!value) continue;
    const p = document.createElement('p'); p.textContent = value; popup.append(p);
  }
  const link = document.createElement('a'); link.textContent = 'Googleマップで開く';
  link.href = safeGoogleMapsUrl(pin.googleMapsUrl) ?? `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`;
  link.target = '_blank'; link.rel = 'noopener noreferrer'; popup.append(link);
  const add = document.createElement('button'); add.type = 'button'; add.className = 'btn'; add.textContent = 'ここを経由点に追加';
  add.onclick = () => addWaypoint({ lat: pin.lat, lng: pin.lng }); popup.append(add);
  L.DomEvent.disableClickPropagation(popup);
  return popup;
}

export function installPinsUI(map: L.Map, addWaypoint: (point: { lat: number; lng: number }) => void, warn: (message: string) => void) {
  map.createPane('pinPane').style.zIndex = '340';
  const renderer = L.canvas({ pane: 'pinPane', padding: 0.5 });
  const layer = L.layerGroup().addTo(map);
  let sources = loadPins();
  const section = document.createElement('section'); section.className = 'pin-sources';
  // Deletion detaches the click target before Leaflet inspects its ancestors.
  // Stop the actual event as well, so rebuilding rows never adds a map waypoint.
  L.DomEvent.on(section, 'click', L.DomEvent.stopPropagation);
  const heading = document.createElement('h3'); heading.textContent = 'マイピン';
  const list = document.createElement('div'); section.append(heading, list);
  document.getElementById('layer-pop')!.append(section);
  // Canvas strokes extend one pixel on either side: outer diameter is 14 / 8 px.
  const radius = () => map.getZoom() < 12 ? 3 : 6;
  const persist = () => warn(savePins(sources) ? '' : 'ピンを保存できません。容量不足または保存が無効です。現在の画面にだけ反映しています。');
  function render() {
    layer.clearLayers(); list.replaceChildren();
    if (!sources.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'KML・KMZ・GeoJSONを読み込めます。'; list.append(empty);
    }
    const color = getComputedStyle(document.documentElement).getPropertyValue('--pin').trim() || '#d93025';
    for (const source of sources) {
      const row = document.createElement('div'); row.className = 'pin-source';
      const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = source.visible;
      const name = document.createElement('span'); name.textContent = `${source.name}（${source.pins.length}件）`;
      label.append(check, name);
      check.onchange = () => { source.visible = check.checked; persist(); render(); };
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pin-delete'; remove.textContent = '削除';
      remove.setAttribute('aria-label', `${source.name}を削除`);
      remove.onclick = () => {
        if (!confirm(`「${source.name}」のピンを削除しますか？`)) return;
        sources = deletePinSource(sources, source.name); persist(); render();
      };
      row.append(label, remove); list.append(row);
      if (!source.visible) continue;
      for (const pin of source.pins) {
        L.circleMarker([pin.lat, pin.lng], { renderer, pane: 'pinPane', radius: radius(), color: '#fff', weight: 2,
          fillColor: color, fillOpacity: 1, bubblingMouseEvents: false })
          .bindPopup(() => pinPopup(pin, source.name, point => { addWaypoint(point); map.closePopup(); }), { maxWidth: 260 })
          .addTo(layer);
      }
    }
  }
  map.on('zoomend', () => layer.eachLayer(marker => (marker as L.CircleMarker).setRadius(radius())));
  render();
  return {
    import(name: string, pins: Pin[]) {
      const source: PinSource = { name, pins, visible: true };
      sources = replacePinSource(sources, source); persist(); render();
    },
  };
}
