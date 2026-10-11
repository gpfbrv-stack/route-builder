export const PIN_STORAGE_KEY = 'route-builder:pins:v1';
export const MAX_PIN_BYTES = 20_000_000;
export const MAX_PINS = 5_000;
export interface Pin { lat: number; lng: number; name: string; description?: string; folder?: string; address?: string; googleMapsUrl?: string }
export interface PinSource { name: string; visible: boolean; pins: Pin[] }
export interface PinImport { pins: Pin[]; skipped: number }
type Format = 'gpx' | 'kml' | 'kmz' | 'geojson';
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validCoordinates = (lat: unknown, lng: unknown): boolean => typeof lat === 'number' && typeof lng === 'number'
  && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0);
const elements = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS('*', name));
const childText = (el: Element, name: string) => text(Array.from(el.children).find(child => child.localName === name)?.textContent);
function xml(input: string): Document {
  const doc = new DOMParser().parseFromString(input, 'application/xml');
  if (elements(doc, 'parsererror').length) throw new Error('XMLの形式が正しくありません');
  return doc;
}
export function detectImportFormat(name: string, content: string | Uint8Array): Format {
  if (content instanceof Uint8Array) {
    if (content[0] === 0x50 && content[1] === 0x4b) return 'kmz';
    return detectImportFormat(name, new TextDecoder().decode(content));
  }
  const value = content.trim();
  if (content.startsWith('PK')) return 'kmz';
  if (value.startsWith('<')) {
    const root = xml(value).documentElement.localName;
    if (root === 'gpx' || root === 'kml') return root;
  }
  if (value.startsWith('{')) {
    if (JSON.parse(value).type === 'FeatureCollection') return 'geojson';
  }
  if (/\.kmz$/i.test(name)) return 'kmz';
  throw new Error('GPX・KML・KMZ・GeoJSONのファイルを選択してください');
}
function add(result: PinImport, pin: Pin) {
  if (!validCoordinates(pin.lat, pin.lng)) { result.skipped++; return; }
  if (result.pins.length >= MAX_PINS) throw new Error('ピンは1ファイル5,000件までです');
  result.pins.push(pin);
}
/** A detached template is inert: descriptions cannot load images or execute scripts. */
function plainDescription(value: string): string {
  const template = document.createElement('template'); template.innerHTML = value;
  template.content.querySelectorAll('script,style,iframe,object').forEach(el => el.remove());
  template.content.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  template.content.querySelectorAll('p,div,li').forEach(el => el.append('\n'));
  return text(template.content.textContent);
}
export function parseKml(input: string): PinImport {
  const doc = xml(input);
  if (doc.documentElement.localName !== 'kml') throw new Error('KMLの形式が正しくありません');
  const result: PinImport = { pins: [], skipped: 0 };
  for (const place of elements(doc, 'Placemark')) {
    const points = elements(place, 'Point');
    result.skipped += elements(place, 'LineString').length + elements(place, 'Polygon').length;
    if (!points.length && !elements(place, 'LineString').length && !elements(place, 'Polygon').length) result.skipped++;
    let folder: Element | null = place.parentElement;
    while (folder && folder.localName !== 'Folder') folder = folder.parentElement;
    for (const point of points) {
      const raw = text(elements(point, 'coordinates')[0]?.textContent).split(',');
      const lng = raw[0]?.trim() ? Number(raw[0]) : NaN, lat = raw[1]?.trim() ? Number(raw[1]) : NaN;
      add(result, { lng, lat, name: childText(place, 'name') || '名称なし',
        description: plainDescription(childText(place, 'description')), folder: folder ? childText(folder, 'name') : undefined });
    }
  }
  return result;
}
export function safeGoogleMapsUrl(value: unknown): string | undefined {
  try {
    const url = new URL(text(value));
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
      (['www.google.com', 'maps.google.com', 'google.com', 'www.google.co.jp', 'maps.google.co.jp', 'google.co.jp', 'maps.app.goo.gl', 'goo.gl'].includes(url.hostname))) return url.href;
  } catch { /* Untrusted file content is never used as an executable link. */ }
  return undefined;
}
export function parsePinGeoJson(input: string): PinImport {
  const data = JSON.parse(input);
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('GeoJSONのFeatureCollectionを選択してください');
  const result: PinImport = { pins: [], skipped: 0 };
  for (const feature of data.features) {
    if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) { result.skipped++; continue; }
    const [lng, lat] = feature.geometry.coordinates, p = feature.properties ?? {};
    add(result, { lat, lng, name: text(p.Title) || text(p.location?.name) || text(p.name) || '名称なし',
      address: text(p.location?.address), googleMapsUrl: safeGoogleMapsUrl(p.google_maps_url) });
  }
  return result;
}

const kmzError = () => new Error('KMZが壊れているか、未対応のZIP形式です。KMLで書き出してください');
/** Read local headers; central directory sizes also support ZIP data descriptors. */
export async function extractKmz(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_PIN_BYTES) throw new Error('ファイルは20MBまでです');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sizes = new Map<number, { compressed: number; expanded: number }>();
  // Locate EOCD only in the ZIP comment window, then inspect directory records.
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) continue;
    let offset = view.getUint32(end + 16, true);
    for (let i = 0; i < view.getUint16(end + 10, true); i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw kmzError();
      sizes.set(view.getUint32(offset + 42, true), { compressed: view.getUint32(offset + 20, true), expanded: view.getUint32(offset + 24, true) });
      offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    break;
  }
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true), method = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const size = flags & 8 ? sizes.get(offset) : { compressed: view.getUint32(offset + 18, true), expanded: view.getUint32(offset + 22, true) };
    const start = offset + 30 + nameLength + extraLength;
    if (!size || start + size.compressed > bytes.length || flags & 1) throw kmzError();
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    if (/\.kml$/i.test(name)) {
      if (size.expanded > MAX_PIN_BYTES) throw new Error('展開後のKMLは20MBまでです');
      const compressed = bytes.slice(start, start + size.compressed);
      if (method === 0) {
        if (size.compressed !== size.expanded) throw kmzError();
        return new TextDecoder().decode(compressed);
      }
      if (method !== 8) throw kmzError();
      let decompressor: DecompressionStream;
      try { decompressor = new DecompressionStream('deflate-raw'); }
      catch { throw new Error('この端末ではKMZを開けません。KMLで書き出してください'); }
      const reader = new Response(compressed).body!.pipeThrough(decompressor).getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > MAX_PIN_BYTES) { await reader.cancel(); throw new Error('展開後のKMLは20MBまでです'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (length !== size.expanded) throw kmzError();
      const output = new Uint8Array(length); let at = 0;
      for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
      return new TextDecoder().decode(output);
    }
    offset = start + size.compressed;
    if (flags & 8) {
      if (offset + 4 > bytes.length) throw kmzError();
      offset += view.getUint32(offset, true) === 0x08074b50 ? 16 : 12;
    }
  }
  throw new Error('KMZ内にKMLがありません');
}
export function replacePinSource(sources: PinSource[], source: PinSource): PinSource[] {
  const existing = sources.findIndex(item => item.name === source.name);
  return existing < 0 ? [...sources, source] : sources.map((item, i) => i === existing ? source : item);
}
export function deletePinSource(sources: PinSource[], name: string): PinSource[] { return sources.filter(source => source.name !== name); }
export function savePins(sources: PinSource[], storage?: Pick<Storage, 'setItem'>): boolean {
  try { (storage ?? localStorage).setItem(PIN_STORAGE_KEY, JSON.stringify(sources)); return true; } catch { return false; }
}
export function loadPins(storage?: Pick<Storage, 'getItem'>): PinSource[] {
  try {
    const value: unknown = JSON.parse((storage ?? localStorage).getItem(PIN_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((s): s is PinSource => s && typeof s.name === 'string' && typeof s.visible === 'boolean' && Array.isArray(s.pins)
      && s.pins.length <= MAX_PINS && s.pins.every((p: Pin) => p && validCoordinates(p.lat, p.lng) && typeof p.name === 'string'
        && ['description', 'folder', 'address', 'googleMapsUrl'].every(key => p[key as keyof Pin] === undefined || typeof p[key as keyof Pin] === 'string')));
  } catch { return []; }
}
