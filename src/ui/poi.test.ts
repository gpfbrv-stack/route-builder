// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import L from 'leaflet';
import { mountUI } from './layout';
import { installPoiUI, loadPoiVisibility, loadPoiExport, poiPopup } from './poi';
import type { Poi } from '../types';

let map: L.Map;
const $ = (id: string) => document.getElementById(id)!;
const poi = (id: number, kind: Poi['kind'] = 'conv'): Poi => ({ id: String(id), lat: 35, lng: 135, name: '店' + id, kind, routeDistance: id * 1000, offset: 40, count: 1 });
const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.chip')].find(b => b.textContent!.includes(label))!;
beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<div id="app"></div>'; mountUI(); map = L.map('map').setView([35, 135], 13); });
afterEach(() => { map.remove(); vi.restoreAllMocks(); });
it('switches map/list visibility, preserves focus and reloads saved choices', () => {
  const ui = installPoiUI(map); ui.set([poi(1), poi(2, 'wc')], 25000);
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(1);
  const conv = chip('コンビニ'); conv.focus(); conv.click();
  expect(document.activeElement).toBe(conv);
  expect(conv.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelectorAll('.poi-row')).toHaveLength(0);
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(0);
  chip('トイレ').click(); expect(document.querySelectorAll('.poi-row')).toHaveLength(1);
  expect(loadPoiVisibility()).toMatchObject({ conv: false, wc: true });
  expect($('gap-note').textContent).toContain('24.0 km');
});
it('shows 30 rows, all markers, then more rows and focuses the first added row', () => {
  const ui = installPoiUI(map); ui.set(Array.from({ length: 65 }, (_, i) => poi(i)), 65000);
  expect(document.querySelectorAll('.poi-row')).toHaveLength(30);
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(65);
  $('poi-more').click(); expect(document.querySelectorAll('.poi-row')).toHaveLength(60);
  expect(document.activeElement?.textContent).toContain('店30');
  $('poi-more').click(); expect(document.querySelectorAll('.poi-row')).toHaveLength(65); expect($('poi-more').hidden).toBe(true);
});
it('counts individual machines, groups markers and changes marker size at zoom 13', () => {
  const ui = installPoiUI(map); ui.set([poi(1, 'vend'), { ...poi(2, 'vend'), routeDistance: 1200 }], 2000);
  expect(chip('自販機').querySelector('.count')!.textContent).toBe('2');
  expect(document.querySelectorAll('.poi-marker')).toHaveLength(1);
  expect($('poi-list').textContent).toContain('自販機 2台');
  map.setZoom(12); expect(document.querySelector('.poi-marker.small')).not.toBeNull();
  map.setZoom(13); expect(document.querySelector('.poi-marker.small')).toBeNull();
  expect(map.getPane('poiPane')!.style.zIndex).toBe('350');
  document.querySelector<HTMLButtonElement>('.poi-row')!.click();
  expect(document.querySelector('.leaflet-popup .poi-pop')!.textContent).toContain('自販機 2台');
});
it('distinguishes pending, busy, failure and empty data and uses the exact gap threshold', () => {
  const ui = installPoiUI(map);
  ui.reset('検索中'); expect($('gap-note').hidden).toBe(true);
  ui.message('Overpassが混雑中'); expect($('poi-status').textContent).toBe('Overpassが混雑中');
  ui.reset('取得失敗'); expect($('gap-note').hidden).toBe(true);
  ui.set([], 20000); expect($('gap-note').classList.contains('ok')).toBe(false);
  expect($('poi-status').textContent).toContain('見つかりませんでした');
  ui.set([], 19999); expect($('gap-note').classList.contains('ok')).toBe(true);
  ui.reset('検索待ち'); expect($('gap-note').hidden).toBe(true);
});
it('validates saved values and works when storage throws', () => {
  localStorage.setItem('route-builder-poi-visible', '{"conv":"false","wc":true}');
  expect(loadPoiVisibility()).toMatchObject({ conv: true, wc: true });
  localStorage.setItem('route-builder-poi-visible', 'bad json');
  expect(loadPoiVisibility().wc).toBe(false);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const ui = installPoiUI(map); ui.set([poi(1)], 3000); chip('コンビニ').click();
  expect(document.querySelectorAll('.poi-row')).toHaveLength(0);
});
it('renders untrusted names/hours as text and creates only a user-operated external link', () => {
  const popup = poiPopup({ ...poi(1), name: '<img src=x onerror=alert(1)>', hours: '<script>bad()</script>' });
  expect(popup.querySelector('img,script')).toBeNull();
  const link = popup.querySelector('a')!;
  expect(link.href).toBe('https://www.google.com/maps/search/?api=1&query=35,135');
  expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener');
});
it('clears old counts, gap, rows, markers and export/chart data as a search starts', () => {
  const changed = vi.fn(), ui = installPoiUI(map, changed);
  ui.set([poi(1)], 30000); document.querySelector<HTMLButtonElement>('.poi-row')!.click();
  expect($('gap-note').hidden).toBe(false);
  ui.reset('補給・休憩を検索中…');
  expect($('poi-status').textContent).toBe('補給・休憩を検索中…');
  expect($('gap-note').hidden).toBe(true); expect($('gap-note').textContent).toBe('');
  expect(document.querySelectorAll('.poi-row,.poi-marker,.poi-pop')).toHaveLength(0);
  expect([...document.querySelectorAll('.chip .count')].every(n => n.textContent === '0')).toBe(true);
  expect($('poi-more').hidden).toBe(true);
  expect(ui.chartPois).toEqual([]); expect(ui.exportPois).toEqual([]); expect(ui.gap).toBeNull();
  chip('コンビニ').click(); expect($('poi-status').textContent).toContain('検索中');
  expect(changed).toHaveBeenCalledTimes(3);
});
it('only asks for a category when all categories are off, including empty datasets', () => {
  const ui = installPoiUI(map); ui.set([poi(1, 'wc')], 5000);
  expect($('poi-status').textContent).toBe('ルート沿いに登録された地物は見つかりませんでした。');
  document.querySelectorAll<HTMLButtonElement>('.chip[aria-pressed="true"]').forEach(b => b.click());
  expect($('poi-status').textContent).toBe('表示する種類を選んでください。');
  ui.set([], 5000); expect($('poi-status').textContent).toBe('表示する種類を選んでください。');
  chip('水場').click(); expect($('poi-status').textContent).toBe('ルート沿いに登録された地物は見つかりませんでした。');
});
it('shares visibility with grouped chart dots and original GPX features, preserving the gap', () => {
  const ui = installPoiUI(map);
  ui.set([poi(1), poi(2, 'vend'), { ...poi(3, 'vend'), routeDistance: 2100 }, poi(4, 'wc')], 30000);
  expect(ui.chartPois).toHaveLength(2); expect(ui.exportPois).toHaveLength(3);
  const gap = ui.gap; chip('コンビニ').click();
  expect(ui.chartPois).toHaveLength(1); expect(ui.exportPois).toHaveLength(2); expect(ui.gap).toEqual(gap);
  const checkbox = $('poi-gpx') as HTMLInputElement;
  expect(checkbox.checked).toBe(true); checkbox.click();
  expect(ui.exportPois).toEqual([]); expect(ui.chartPois).toHaveLength(1); expect(loadPoiExport()).toBe(false);
  checkbox.click(); expect(loadPoiExport()).toBe(true); expect(ui.exportPois).toHaveLength(2);
});
it('restores the GPX checkbox and tolerates denied storage', () => {
  localStorage.setItem('route-builder-poi-gpx', 'false');
  const ui = installPoiUI(map); ui.set([poi(1)], 30000);
  expect(($('poi-gpx') as HTMLInputElement).checked).toBe(false); expect(ui.exportPois).toEqual([]);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(loadPoiExport()).toBe(true); $('poi-gpx').click(); expect(ui.exportPois).toHaveLength(1);
});
