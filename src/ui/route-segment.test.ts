import { describe, expect, it } from 'vitest';
import { nearestSegment } from './route-segment';
const p = (lat: number, lng: number) => ({ lat, lng });
describe('insertion segment', () => {
  it('uses the routed shape rather than proximity to waypoints', () => {
    const a = p(35, 135), b = p(35, 135.1), c = p(35.1, 135.1);
    expect(nearestSegment([[a, p(35.08, 135.101), b], [b, c]], p(35.08, 135.101))).toBe(0);
  });
  it('supports straight segments and deterministic ties at a shared endpoint', () => {
    const a = p(35, 135), b = p(35, 135.1), c = p(35.1, 135.1);
    expect(nearestSegment([[a, b], [b, c]], p(35.08, 135.1))).toBe(1);
    expect(nearestSegment([[a, b], [b, c]], b)).toBe(0);
  });
  it('keeps original indexes when shapes are empty', () => {
    expect(nearestSegment([[], [p(35, 135)], [p(35, 135), p(35.1, 135)]], p(35.05, 135))).toBe(2);
    expect(nearestSegment([], p(35, 135))).toBe(-1);
  });
});
