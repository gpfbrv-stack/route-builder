import { expect, it } from 'vitest';
import { classifyPoi, groupVending, longestSupplyGap, preparePois, sortPois } from './poi';
import type { Poi } from './types';

const poi = (routeDistance: number, kind: Poi['kind'] = 'vend'): Poi => ({ id: String(routeDistance), lat: 35, lng: 135, name: '登録名称', kind, routeDistance, offset: 10, count: 1 });
it('classifies every shop and water predicate and rejects non-drinking vending machines', () => {
  for (const shop of ['supermarket', 'general', 'grocery', 'greengrocer', 'bakery', 'deli']) expect(classifyPoi({ shop })).toBe('shop');
  expect(classifyPoi({ shop: 'convenience' })).toBe('conv');
  expect(classifyPoi({ amenity: 'vending_machine' })).toBe('vend');
  expect(classifyPoi({ amenity: 'vending_machine', vending: 'food;drinks' })).toBe('vend');
  expect(classifyPoi({ amenity: 'vending_machine', vending: 'food' })).toBeNull();
  expect(classifyPoi({ amenity: 'drinking_water' })).toBe('water');
  const waterTags: Record<string, string>[] = [{ natural: 'spring' }, { man_made: 'water_tap' }];
  for (const tags of waterTags) {
    expect(classifyPoi(tags)).toBeNull();
    expect(classifyPoi({ ...tags, drinking_water: 'yes' })).toBe('water');
  }
  expect(classifyPoi({ amenity: 'toilets' })).toBe('wc');
  expect(classifyPoi({})).toBeNull();
});
it('prioritizes michi, then the table order for overlapping tags', () => {
  expect(classifyPoi({ name: '道の駅 山', shop: 'convenience' })).toBe('michi');
  for (const highway of ['services', 'rest_area']) expect(classifyPoi({ name: '山の道の駅', highway })).toBe('michi');
  expect(classifyPoi({ name: '山の道の駅' })).toBeNull();
  expect(classifyPoi({ shop: 'convenience', amenity: 'vending_machine' })).toBe('conv');
  expect(classifyPoi({ shop: 'bakery', amenity: 'drinking_water' })).toBe('shop');
  expect(classifyPoi({ amenity: 'vending_machine', natural: 'spring', drinking_water: 'yes' })).toBe('vend');
  expect(classifyPoi({ amenity: 'toilets', man_made: 'water_tap', drinking_water: 'yes' })).toBe('water');
});
it('uses Japanese name, name, brand, label and formats only 24/7 hours', () => {
  const tags: Record<string, string>[] = [{ 'name:ja': '日本語', name: 'Name', brand: 'Brand', opening_hours: '24/7' }, { name: 'Name', brand: 'Brand', opening_hours: 'Mo-Fr 09:00-17:00' }, { brand: 'Brand' }, {}];
  const prepared = preparePois(tags.map((tags, id) => ({ type: 'node', id, lat: 35, lon: 135, kind: 'conv', routeDistance: id * 100, offset: 20, tags })));
  expect(prepared.map(p => p.name)).toEqual(['日本語', 'Name', 'Brand', 'コンビニ']);
  expect(prepared.map(p => p.hours)).toEqual(['24時間', 'Mo-Fr 09:00-17:00', undefined, undefined]);
  expect(prepared[0]).toMatchObject({ id: 'node/0', lng: 135, count: 1 });
});
it('sorts without changing source data and handles empty input', () => {
  const source = [poi(400), poi(0)];
  expect(sortPois(source).map(p => p.routeDistance)).toEqual([0, 400]);
  expect(source[0].routeDistance).toBe(400);
  expect(groupVending([])).toEqual([]);
});
it('groups chained vending distances inclusively at 200m, preserving a single representative', () => {
  const source = [poi(400), poi(100, 'water'), poi(0), poi(200), poi(601)];
  const grouped = groupVending(source);
  expect(grouped.map(p => [p.routeDistance, p.count])).toEqual([[0, 3], [100, 1], [601, 1]]);
  expect(grouped[0]).toMatchObject({ name: '自販機 3台', id: '0', offset: 10 });
  expect(grouped[2].name).toBe('登録名称');
  expect(source.every(p => p.count === 1)).toBe(true);
});
it('includes route endpoints, ignores water/vending/toilets and handles no supply', () => {
  expect(longestSupplyGap([], 25000)).toEqual({ from: 0, to: 25000 });
  expect(longestSupplyGap([], 0)).toEqual({ from: 0, to: 0 });
  expect(longestSupplyGap([poi(10000), poi(15000, 'water'), poi(20000, 'wc')], 25000)).toEqual({ from: 0, to: 25000 });
  expect(longestSupplyGap([poi(22000, 'conv')], 25000)).toEqual({ from: 0, to: 22000 });
  expect(longestSupplyGap([poi(2000, 'shop')], 25000)).toEqual({ from: 2000, to: 25000 });
});
it('finds the interior gap from unsorted supply points, including michi and duplicate distances', () => {
  expect(longestSupplyGap([poi(26000, 'michi'), poi(4000, 'conv'), poi(4000, 'shop')], 30000)).toEqual({ from: 4000, to: 26000 });
});
