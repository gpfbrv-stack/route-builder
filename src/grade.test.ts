import { describe, expect, it } from 'vitest';
import { gradeBins, gradeColor } from './grade';
const samples = (...pairs: [number, number | null][]) => pairs.map(([distance, ele]) => ({ distance, ele }));
describe('500 m grades', () => {
  it('interpolates exact boundaries and the final partial bin', () => {
    expect(gradeBins(samples([0, 0], [300, 30], [600, 60], [750, 75]))).toEqual([{ from: 0, to: 500, grade: 10 }, { from: 500, to: 750, grade: 10 }]);
  });
  it('leaves bins with missing interior samples unfilled', () => {
    expect(gradeBins(samples([0, 0], [250, null], [500, 50], [1000, 0]))).toEqual([{ from: 0, to: 500, grade: null }, { from: 500, to: 1000, grade: -10 }]);
  });
  it('does not interpolate across missing boundary support', () => {
    expect(gradeBins(samples([0, 0], [400, null], [600, 60], [1000, 100])).map(b => b.grade)).toEqual([null, null]);
  });
  it('handles empty, single and zero length input', () => {
    expect(gradeBins([])).toEqual([]); expect(gradeBins(samples([0, 10]))).toEqual([]); expect(gradeBins(samples([0, 10], [0, 20]))).toEqual([]);
  });
  it('rejects invalid sizes', () => { for (const n of [0, -1, NaN, Infinity]) expect(() => gradeBins([], n)).toThrow(); });
  it('uses specified thresholds', () => {
    expect([null, -1, 0, 2.99, 3, 6, 9, 12].map(gradeColor)).toEqual(['none','var(--gdown)','var(--g0)','var(--g0)','var(--g3)','var(--g6)','var(--g9)','var(--g12)']);
  });
});
