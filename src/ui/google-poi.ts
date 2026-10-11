import type L from 'leaflet';
import { GoogleLayer } from '../google-layer';
import { GoogleSessions } from '../google';

export const GOOGLE_POI_STORAGE_KEY = 'route-builder-google-poi';

export function installGooglePoi(map: L.Map, pop: HTMLElement, notify: (message: string) => void,
  key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()) {
  if (!key) return { setBackground: (_google: boolean) => {} };
  let enabled = true, googleBackground = false, failed = false;
  try { enabled = localStorage.getItem(GOOGLE_POI_STORAGE_KEY) !== 'false'; } catch { /* Use default. */ }
  const section = document.createElement('section'); section.className = 'google-poi-options';
  section.innerHTML = '<h3>重ねる</h3><label class="check-row"><input type="checkbox" aria-describedby="google-poi-hint"><span>Googleの施設・地名<small id="google-poi-hint"></small></span></label>';
  pop.append(section);
  const toggle = section.querySelector('input')!;
  const hint = section.querySelector('small')!;
  const layer = new GoogleLayer('poiOverlay', key, new GoogleSessions(key), notify, () => {
    failed = true; sync();
  });
  const sync = () => {
    toggle.checked = enabled && !failed; toggle.disabled = googleBackground;
    hint.textContent = googleBackground ? 'Google背景では不要' : failed ? '取得失敗・再度ONで再試行' : map.getZoom() < 13 ? 'ズーム13以上で表示' : '';
    const visible = enabled && !failed && !googleBackground && map.getZoom() >= 13;
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    else if (!visible && map.hasLayer(layer)) layer.remove();
  };
  toggle.onchange = () => {
    enabled = toggle.checked; failed = false;
    try { localStorage.setItem(GOOGLE_POI_STORAGE_KEY, String(enabled)); } catch { /* Selection still works. */ }
    sync();
  };
  map.on('zoomend', sync);
  map.once('unload', () => { map.off('zoomend', sync); toggle.onchange = null; });
  // The initial background must be known before any Google request is started.
  return { setBackground(google: boolean) { googleBackground = google; sync(); } };
}
