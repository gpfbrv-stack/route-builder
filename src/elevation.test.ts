import { expect, it, vi } from 'vitest';
import { decodeDEM, elevationStats, sampleRoute, tilePixel } from './elevation';
import { DemProvider } from './dem';
it('decodes positive, negative, zero, no-data and alpha', () => {
  expect(decodeDEM(0, 39, 16)).toBe(100);
  expect(decodeDEM(255, 255, 156)).toBe(-1);
  expect(decodeDEM(0, 0, 0)).toBe(0);
  expect(decodeDEM(128, 0, 0)).toBeNull();
  expect(decodeDEM(0, 0, 0, 0)).toBeNull();
});
it('ignores sub-threshold reversals and preserves accepted extremes', () => {
  expect(elevationStats([0, 10, 7, 12, 0])).toEqual({ ascent: 12, descent: 12, highest: 12 });
  expect(elevationStats([100, 102, 99, 103])).toEqual({ ascent: 0, descent: 0, highest: 103 });
  expect(elevationStats([0, 5, 0])).toEqual({ ascent: 5, descent: 5, highest: 5 });
  expect(elevationStats([20, 10, 0])).toEqual({ ascent: 0, descent: 20, highest: 20 });
  expect(elevationStats([0, 10, null, 100, 105])).toEqual({ ascent: 15, descent: 0, highest: 105 });
  expect(elevationStats([])).toEqual({ ascent: 0, descent: 0, highest: null });
});
it('samples endpoints and approximately 20m steps', () => {
  const result = sampleRoute([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }]);
  expect(result).toHaveLength(7); expect(result[1].distance).toBe(20);
  expect(result.at(-1)!.lng).toBeCloseTo(0.001);
  expect(sampleRoute([{ lat: 0, lng: 0 }])).toHaveLength(1);
  expect(tilePixel({ lat: 0, lng: 0 })).toEqual({ x: 8192, y: 8192, px: 0, py: 0 });
});
it('falls back on invalid pixel and caches tile requests', async () => {
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 4) { data[i + 2] = 100; data[i + 3] = 255; }
  const load = vi.fn(async (url: string) => url.includes('dem5a') ? null : data);
  const provider = new DemProvider(load);
  expect(await provider.elevation({ lat: 0, lng: 0 })).toBe(1);
  expect(await provider.elevation({ lat: 0, lng: 0.00001 })).toBe(1);
  expect(load).toHaveBeenCalledTimes(2);
});
