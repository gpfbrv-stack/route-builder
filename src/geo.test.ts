import { expect, it } from 'vitest';
import { cumulativeDistances, distance, validPoint } from './geo';
it('computes geodesic distances in metres', () => {
  expect(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111195.08, 1);
  expect(distance({ lat: 35, lng: 135 }, { lat: 35, lng: 135 })).toBe(0);
  expect(distance({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015114.44, 1);
  expect(cumulativeDistances([])).toEqual([]);
  expect(validPoint({ lat: NaN, lng: 0 })).toBe(false);
});
