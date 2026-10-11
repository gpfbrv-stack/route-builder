// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { deletePinSource, detectImportFormat, extractKmz, loadPins, MAX_PIN_BYTES, MAX_PINS, parseKml, parsePinGeoJson, PIN_STORAGE_KEY, replacePinSource, safeGoogleMapsUrl, savePins, type PinSource } from './pins';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
const kml = '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>山</name><Placemark><name>峠</name><description><![CDATA[<p>説明<br>続き &amp; 詳細</p><img src="https://example.com/a"><script>alert(1)</script>]]></description><Point><coordinates>135.7,35.1,750</coordinates></Point></Placemark><Placemark><LineString><coordinates>135,35 136,36</coordinates></LineString></Placemark><Placemark><Polygon/></Placemark></Folder></Document></kml>';
const feature = (coordinates: unknown, properties: unknown = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
const geo = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });

it('reads KML folders, HTML descriptions and 3D coordinates, counting unsupported geometries', () => {
  const result = parseKml(kml);
  expect(result.skipped).toBe(2);
  expect(result.pins).toEqual([{ lat: 35.1, lng: 135.7, name: '峠', folder: '山', description: '説明\n続き & 詳細' }]);
});
it('supports prefixed KML, nearest folders and rejects malformed/empty coordinates', () => {
  const result = parseKml('<k:kml xmlns:k="urn:kml"><k:Folder><k:name>外</k:name><k:Folder><k:name>内</k:name><k:Placemark><k:Point><k:coordinates>135,35</k:coordinates></k:Point></k:Placemark></k:Folder><k:Placemark><k:Point><k:coordinates>,35</k:coordinates></k:Point></k:Placemark></k:Folder></k:kml>');
  expect(result.pins[0]).toMatchObject({ folder: '内', name: '名称なし' }); expect(result.skipped).toBe(1);
  expect(() => parseKml('<kml>')).toThrow(); expect(() => parseKml('<gpx/>')).toThrow();
});
it('reads Takeout names in priority order and keeps address and Google URL', () => {
  const result = parsePinGeoJson(geo([
    feature([135, 35, 800], { Title: '題名', name: '低優先', location: { name: '場所', address: '京都' }, google_maps_url: 'https://maps.google.com/?cid=123' }),
    feature([136, 36], { location: { name: '場所' }, name: '低優先' }), feature([137, 37], { name: '名前' }), feature([138, 38]),
  ]));
  expect(result.pins.map(p => p.name)).toEqual(['題名', '場所', '名前', '名称なし']);
  expect(result.pins[0]).toMatchObject({ address: '京都', googleMapsUrl: 'https://maps.google.com/?cid=123' });
});
it('skips null island, out-of-range, wrong types and non-points', () => {
  const result = parsePinGeoJson(geo([feature([0, 0]), feature([181, 35]), feature([135, -91]), feature(['135', 35]), feature([135]), null,
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }, feature([0, 35])]));
  expect(result.skipped).toBe(7); expect(result.pins).toHaveLength(1);
  expect(() => parsePinGeoJson('{"type":"Point"}')).toThrow();
});
it('accepts exactly 5000 points and rejects rather than truncating larger imports', () => {
  expect(parsePinGeoJson(geo(Array.from({ length: MAX_PINS }, () => feature([135, 35])))).pins).toHaveLength(MAX_PINS);
  expect(() => parsePinGeoJson(geo(Array.from({ length: MAX_PINS + 1 }, () => feature([135, 35]))))).toThrow('5,000');
  expect(() => parseKml(`<kml>${'<Placemark><Point><coordinates>135,35</coordinates></Point></Placemark>'.repeat(MAX_PINS + 1)}</kml>`)).toThrow('5,000');
});
it('detects content even with another extension, and refuses arbitrary JSON/XML', () => {
  expect(detectImportFormat('x.json', kml)).toBe('kml');
  expect(detectImportFormat('x.kml', '\ufeff<?xml version="1.0"?><gpx/>')).toBe('gpx');
  expect(detectImportFormat('Saved Places.json', geo([]))).toBe('geojson');
  expect(detectImportFormat('unknown', new Uint8Array([80, 75, 3, 4]))).toBe('kmz');
  expect(detectImportFormat('unknown', 'PK\x03\x04')).toBe('kmz');
  expect(() => detectImportFormat('x.json', '{}')).toThrow(); expect(() => detectImportFormat('x.gpx', '<html/>')).toThrow();
});

/** Small real ZIP fixture, with optional streaming data descriptors. */
async function zip(entries: { name: string; content: string; method?: number }[], descriptor = false): Promise<Uint8Array> {
  const locals: Uint8Array[] = [], directory: Uint8Array[] = []; let offset = 0;
  const concat = (parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
    for (const p of parts) { result.set(p, at); at += p.length; } return result;
  };
  const header = (length: number) => {
    const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
    return { bytes, u16: (value: number, at: number) => view.setUint16(at, value, true), u32: (value: number, at = 0) => view.setUint32(at, value, true) };
  };
  for (const entry of entries) {
    const raw = new TextEncoder().encode(entry.content), name = new TextEncoder().encode(entry.name), method = entry.method ?? 8;
    const compressed = method === 0 ? raw : new Uint8Array(await new Response(new Response(raw).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    // CRC-32 for a standards-compliant fixture.
    let crc = 0xffffffff;
    for (const byte of raw) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30); local.u32(0x04034b50); local.u16(20, 4); local.u16(descriptor ? 8 : 0, 6); local.u16(method, 8);
    if (!descriptor) { local.u32(crc, 14); local.u32(compressed.length, 18); local.u32(raw.length, 22); }
    local.u16(name.length, 26);
    const central = header(46); central.u32(0x02014b50); central.u32(compressed.length, 20); central.u32(raw.length, 24);
    central.u16(name.length, 28); central.u32(offset, 42); directory.push(central.bytes, name);
    locals.push(local.bytes, name, compressed); offset += local.bytes.length + name.length + compressed.length;
    if (descriptor) { const data = header(16); data.u32(0x08074b50); data.u32(crc, 4); data.u32(compressed.length, 8); data.u32(raw.length, 12); locals.push(data.bytes); offset += data.bytes.length; }
  }
  const dir = concat(directory), end = header(22); end.u32(0x06054b50); end.u16(entries.length, 8); end.u16(entries.length, 10); end.u32(dir.length, 12); end.u32(offset, 16);
  return concat([...locals, dir, end.bytes]);
}
it.each([false, true])('extracts first KML from a generated deflated ZIP (descriptor=%s)', async descriptor => {
  const bytes = await zip([{ name: 'images/icon.png', content: 'ignored' }, { name: 'doc.kml', content: kml }, { name: 'other.kml', content: '<kml/>' }], descriptor);
  expect(parseKml(await extractKmz(bytes)).pins[0].name).toBe('峠');
});
it('reads stored ZIPs and reports missing KML, truncation, encryption and unsupported compression', async () => {
  expect(await extractKmz(await zip([{ name: 'folder/DOC.KML', content: kml, method: 0 }]))).toBe(kml);
  await expect(extractKmz(await zip([{ name: 'a.txt', content: 'x' }]))).rejects.toThrow('KMLがありません');
  await expect(extractKmz((await zip([{ name: 'doc.kml', content: kml }])).slice(0, 40))).rejects.toThrow();
  const encrypted = await zip([{ name: 'doc.kml', content: kml }]); encrypted[6] = 1;
  await expect(extractKmz(encrypted)).rejects.toThrow('未対応');
  await expect(extractKmz(await zip([{ name: 'doc.kml', content: kml, method: 12 }]))).rejects.toThrow('未対応');
});
it('reports unsupported deflate-raw and enforces compressed and expanded byte limits', async () => {
  const bytes = await zip([{ name: 'doc.kml', content: kml }]);
  vi.stubGlobal('DecompressionStream', undefined);
  await expect(extractKmz(bytes)).rejects.toThrow('この端末ではKMZを開けません。KMLで書き出してください');
  new DataView(bytes.buffer).setUint32(22, MAX_PIN_BYTES + 1, true);
  await expect(extractKmz(bytes)).rejects.toThrow('展開後');
  await expect(extractKmz(new Uint8Array(MAX_PIN_BYTES + 1))).rejects.toThrow('20MB');
});
it('enforces the actual expanded size even when a ZIP header understates it', async () => {
  const bytes = await zip([{ name: 'doc.kml', content: 'x'.repeat(MAX_PIN_BYTES + 1) }]);
  new DataView(bytes.buffer).setUint32(22, 1, true);
  await expect(extractKmz(bytes)).rejects.toThrow('展開後のKMLは20MBまでです');
});
const source: PinSource = { name: 'a.kml', visible: true, pins: [{ lat: 35, lng: 135, name: '山' }] };
it('saves multiple sources, replaces by filename, persists visibility and deletes', () => {
  let sources = replacePinSource([], source);
  sources = replacePinSource(sources, { ...source, name: 'b.json' });
  sources = replacePinSource(sources, { ...source, visible: false, pins: [] });
  expect(sources).toHaveLength(2); expect(savePins(sources)).toBe(true); expect(loadPins()).toEqual(sources);
  sources = deletePinSource(sources, 'a.kml'); savePins(sources); expect(loadPins()).toEqual([expect.objectContaining({ name: 'b.json' })]);
});
it('preserves prior storage on quota failure and handles unavailable or corrupt storage', () => {
  savePins([source]);
  expect(savePins([], { setItem() { throw new DOMException('quota', 'QuotaExceededError'); } })).toBe(false);
  expect(loadPins()).toEqual([source]);
  expect(loadPins({ getItem() { throw new Error('denied'); } })).toEqual([]);
  for (const value of ['null', '{}', 'broken', '[{"name":"a","visible":true,"pins":[null]}]']) { localStorage.setItem(PIN_STORAGE_KEY, value); expect(loadPins()).toEqual([]); }
});
it('allows Google web links, including HTTP URLs found in Takeout', () => {
  expect(safeGoogleMapsUrl('https://maps.app.goo.gl/abc')).toBe('https://maps.app.goo.gl/abc');
  expect(safeGoogleMapsUrl('http://maps.google.com/?cid=123')).toBe('http://maps.google.com/?cid=123');
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'https://google.com.evil.test/', 'https://evil.test/']) expect(safeGoogleMapsUrl(value)).toBeUndefined();
});
