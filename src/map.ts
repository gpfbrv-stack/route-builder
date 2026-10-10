import L from 'leaflet';
import { BASE_LAYERS } from './config';
import { addGoogleLayers } from './google-layer';

export function createMap(element: string, notify: (message: string) => void = () => {}) {
  const map = L.map(element, { zoomControl: false, doubleClickZoom: false }).setView([35.1615, 135.7590], 13);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  const layers: Record<string, L.TileLayer> = {};
  BASE_LAYERS.forEach(config => {
    layers[config.name] = L.tileLayer(config.url, { maxZoom: 19, maxNativeZoom: config.maxNativeZoom, attribution: config.attribution });
  });
  layers['地理院 淡色'].addTo(map);
  const controls = L.control.layers(layers, undefined, { position: 'topright' }).addTo(map);
  addGoogleLayers(map, controls, () => { layers['地理院 淡色'].addTo(map); }, notify);
  return map;
}
