import { expect, it } from 'vitest';
import { applySurfaceMessages, classifySurface, surfaceAt, surfaceSpans, surfaceSummary, surfaceTotals } from './surface';
import { joinSegments } from './routing';
import { routeLength } from './geo';
import type { Point } from './types';

it.each('unpaved gravel fine_gravel compacted dirt earth ground grass sand mud pebblestone rock woodchips'.split(' '))('classifies surface=%s as unpaved', surface => {
  expect(classifySurface(`highway=residential surface=${surface}`)).toBe('unpaved');
});
it.each('asphalt paved concrete concrete:lanes concrete:plates paving_stones sett chipseal metal'.split(' '))('classifies surface=%s as paved', surface => {
  expect(classifySurface(`highway=track surface=${surface}`)).toBe('paved');
});
it.each([2, 3, 4, 5])('classifies tracktype=grade%s as unpaved', grade => {
  expect(classifySurface(`tracktype=grade${grade}`)).toBe('unpaved');
});
it('classifies grade1 as paved and gives unpaved evidence precedence for conflicting tags', () => {
  expect(classifySurface('highway=track tracktype=grade1')).toBe('paved');
  expect(classifySurface('surface=gravel tracktype=grade1')).toBe('unpaved');
  expect(classifySurface('surface=asphalt tracktype=grade2')).toBe('unpaved');
});
it.each('track path bridleway'.split(' '))('infers bare highway=%s as unpaved', highway => {
  expect(classifySurface(`highway=${highway}`)).toBe('unpaved');
  expect(classifySurface(`highway=${highway} surface=wood`)).toBe('unknown');
  expect(classifySurface(`highway=${highway} tracktype=invalid`)).toBe('unknown');
});
it.each('motorway trunk primary secondary tertiary motorway_link trunk_link primary_link secondary_link tertiary_link unclassified residential living_street service cycleway'.split(' '))('infers bare highway=%s as paved', highway => {
  expect(classifySurface(`highway=${highway}`)).toBe('paved');
  expect(classifySurface(`highway=${highway} surface=wood`)).toBe('unknown');
});
it.each(['', 'highway=footway', 'highway=steps', 'surface=wood', 'highway=pedestrian', 'surface=asphalt;gravel', 'tracktype=grade6'])('keeps unsupported tags unknown: %s', tags => {
  expect(classifySurface(tags)).toBe('unknown');
});

const points: Point[] = Array.from({ length: 5 }, (_, i) => ({ lng: 135, lat: 35 + i * .001 }));
const header = ['Latitude', 'WayTags', 'Longitude', 'Distance'];
const row = (i: number, tags: string) => [String(Math.round(points[i].lat * 1e6)), tags, '135000000', '111'];
it('assigns incoming edges through the row endpoint, preserving each boundary and unknown tail', () => {
  const result = applySurfaceMessages(points, [header, row(2, 'surface=asphalt'), row(3, 'surface=gravel')]);
  expect(result.map(p => p.surface ?? 'unknown')).toEqual(['unknown', 'paved', 'paved', 'unpaved', 'unknown']);
  expect(points.every(p => p.surface === undefined)).toBe(true);
  const spans = surfaceSpans(result);
  expect(spans.map(s => s.surface)).toEqual(['paved', 'unpaved', 'unknown']);
  expect(surfaceAt(spans, spans[0].to)).toBe('paved');
  expect(surfaceAt(spans, spans[0].to + .001)).toBe('unpaved');
  expect(surfaceAt(spans, spans.at(-1)!.to)).toBe('unknown');
  const totals = surfaceTotals(spans);
  expect(totals.paved).toBeCloseTo(routeLength(points.slice(0, 3)));
  expect(totals.unpaved).toBeCloseTo(routeLength(points.slice(2, 4)));
  expect(totals.paved + totals.unpaved + totals.unknown).toBeCloseTo(routeLength(points), 8);
});
it('handles repeat visits and a closed loop with positive Distance in route order', () => {
  const loop = [points[0], points[1], points[0], points[1], points[0]];
  const result = applySurfaceMessages(loop, [header, row(1, 'surface=asphalt'), row(0, 'surface=gravel'), row(0, 'highway=steps')]);
  expect(result.map(p => p.surface ?? 'unknown')).toEqual(['unknown', 'paved', 'unpaved', 'unknown', 'unknown']);
});
it('does not overwrite edges at a zero-distance message', () => {
  const zero = row(2, 'surface=gravel'); zero[3] = '0';
  expect(applySurfaceMessages(points, [header, row(2, 'surface=asphalt'), zero, row(4, 'highway=steps')]).map(p => p.surface))
    .toEqual([undefined, 'paved', 'paved', undefined, undefined]);
});
it.each([undefined, null, {}, [], [['bad header']], [header, null], [header, ['bad', 'surface=paved', 'bad']]])('tolerates absent or malformed messages (%j)', messages => {
  expect(applySurfaceMessages(points, messages)).toEqual(points);
});
it('leaves a span with an unmatchable intermediate boundary unknown then recovers', () => {
  const result = applySurfaceMessages(points, [header, ['35001500', 'surface=asphalt', '135000000'], row(3, 'surface=gravel'), row(4, 'surface=asphalt')]);
  expect(result.map(p => p.surface)).toEqual([undefined, undefined, undefined, undefined, 'paved']);
});
it('retains incoming surface at joined legs and counts snapped gaps as unknown', () => {
  const joined = joinSegments([
    { points: [{ ...points[0], surface: 'paved' }, { ...points[1], surface: 'paved' }], fallback: false },
    { points: [{ ...points[1], surface: 'unpaved' }, { ...points[2], surface: 'unpaved' }], fallback: false },
    { points: [{ ...points[3], surface: 'paved' }, { ...points[4], surface: 'paved' }], fallback: false },
  ]);
  expect(joined.map(p => p.surface)).toEqual([undefined, 'paved', 'unpaved', undefined, 'paved']);
  const totals = surfaceTotals(surfaceSpans(joined));
  expect(totals.unknown).toBeCloseTo(routeLength(points.slice(2, 4)));
  expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBeCloseTo(routeLength(joined), 8);
});
it('omits zero distances but keeps a nonzero distance shorter than rounding precision', () => {
  expect(surfaceSummary([])).toBe('');
  expect(surfaceSummary([{ from: 0, to: 20, surface: 'paved' }, { from: 20, to: 1020, surface: 'unknown' }])).toBe('舗装 <0.1km · 不明 1.0km');
  expect(surfaceSpans([points[0], points[0]])).toEqual([]);
  expect(surfaceAt([], 0)).toBe('unknown');
});
