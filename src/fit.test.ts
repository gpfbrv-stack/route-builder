import { describe, expect, it } from 'vitest';
import { Decoder, Profile as FitProfile, Stream } from '@garmin/fitsdk';
import type { DecoderOptions, RecordMesg } from '@garmin/fitsdk';
import { generateFitCourse, type FitCourseInput } from './fit';
import { cumulativeDistances } from './geo';
import { elevationStats } from './elevation';
import { groupVending } from './poi';
import type { Place, Poi, Point } from './types';

const timeCreated = new Date('2026-10-10T01:02:03.456Z');
const track: Point[] = [
  { lat: 35.1180, lng: 135.7706, ele: 123.4 },
  { lat: 35.13, lng: 135.775, ele: 151.7 },
  { lat: 35.14, lng: 135.78, ele: 149.8 },
  { lat: 35.15, lng: 135.783, ele: 170.2 },
  { lat: 35.158743, lng: 135.786125, ele: 144.6 },
];
const defaults: FitCourseInput = { name: '鞍馬花脊ルート', profile: 'mtb', resolvedTrack: track, timeCreated, serialNumber: 0xabcdef01 };
const place = (point: Point, id = 1, routeDistance = 0): Place => ({ ...point, id, name: `峠${id}`, kind: 'pass', routeDistance, offset: 0, elevationSource: 'OSM' });
const poi = (kind: Poi['kind'], point: Point, id = 1, routeDistance = 0): Poi => ({ ...point, id: `${kind}/${id}`, name: `${kind}${id}`, kind, routeDistance, offset: 0, count: 1 });

function decode(bytes: Uint8Array, options: DecoderOptions = {}) {
  expect(bytes).toBeInstanceOf(Uint8Array);
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const result = decoder.read(options);
  expect(result.errors).toEqual([]);
  return result.messages;
}
const generate = (input: Partial<FitCourseInput> = {}, options: DecoderOptions = {}) => decode(generateFitCourse({ ...defaults, ...input }), options);
const rawOptions: DecoderOptions = { applyScaleAndOffset: false, convertTypesToStrings: false, convertDateTimesToDates: false, expandComponents: false, mergeHeartRates: false };
function expectPosition(record: RecordMesg, point: Point) {
  expect(Math.abs(record.positionLat! * 180 / 2 ** 31 - point.lat)).toBeLessThan(1e-5);
  expect(Math.abs(record.positionLong! * 180 / 2 ** 31 - point.lng)).toBeLessThan(1e-5);
}

describe('generateFitCourse', () => {
  it('selects subSport by total routed distance per profile, independent of current selection', () => {
    const messages = generate({ profile: 'mtb', legs: [
      { profile: 'road', distance: 600 }, { profile: 'gravel', distance: 1000 }, { profile: 'road', distance: 600 },
    ] });
    expect(messages.courseMesgs![0].subSport).toBe('road');
    // Only subSport changes: preserve the existing virtual speed policy.
    expect(messages.lapMesgs![0].totalTimerTime).toBe(generate().lapMesgs![0].totalTimerTime);
  });
  it('uses route order for distance ties and the current profile when there is no distance', () => {
    expect(generate({ legs: [{ profile: 'gravel', distance: 100 }, { profile: 'road', distance: 100 }] }).courseMesgs![0].subSport).toBe('gravelCycling');
    expect(generate({ profile: 'road', legs: [{ profile: 'gravel', distance: 0 }] }).courseMesgs![0].subSport).toBe('road');
  });
  it('round-trips course metadata, all records, physical units and lap totals through the SDK', () => {
    const messages = generate(), records = messages.recordMesgs!, lap = messages.lapMesgs![0];
    expect(messages.fileIdMesgs).toEqual([{ type: 'course', manufacturer: 'development', product: 0, serialNumber: defaults.serialNumber, timeCreated: new Date('2026-10-10T01:02:03Z') }]);
    expect(messages.courseMesgs).toEqual([{ name: '鞍馬花脊ル', sport: 'cycling', subSport: 'mountain' }]);
    expect(records).toHaveLength(track.length);
    const distances = cumulativeDistances(track);
    records.forEach((record, i) => {
      expectPosition(record, track[i]);
      expect(Math.abs(record.altitude! - track[i].ele!)).toBeLessThan(1);
      expect(record.distance).toBeCloseTo(distances[i], 2);
      expect(record.distance!).toBeGreaterThanOrEqual(records[Math.max(0, i - 1)].distance!);
      expect(record.timestamp).toEqual(new Date(Date.UTC(2026, 9, 10, 1, 2, 3) + Math.round(distances[i] / (12 / 3.6)) * 1000));
    });
    expect(lap.startPositionLat).toBe(records[0].positionLat);
    expect(lap.startPositionLong).toBe(records[0].positionLong);
    expect(lap.endPositionLat).toBe(records.at(-1)!.positionLat);
    expect(lap.endPositionLong).toBe(records.at(-1)!.positionLong);
    expect(lap.startTime).toEqual(records[0].timestamp);
    expect(lap.timestamp).toEqual(records.at(-1)!.timestamp);
    expect(lap.totalDistance).toBe(records.at(-1)!.distance);
    // The sub-5m reversal is ignored; ascent is 170.2 - 123.4, descent is 170.2 - 144.6.
    expect(lap.totalAscent).toBe(47);
    expect(lap.totalDescent).toBe(26);
    expect(lap.totalElapsedTime).toBeCloseTo(distances.at(-1)! / (12 / 3.6), 3);
    expect(lap.totalTimerTime).toBe(lap.totalElapsedTime);
  });

  it('stores raw SDK scale/offset, enum and FIT epoch values, without double scaling', () => {
    const messages = generate({}, rawOptions), record = messages.recordMesgs![0];
    expect(messages.fileIdMesgs![0]).toMatchObject({ type: 6, manufacturer: 255, serialNumber: 0xabcdef01 });
    expect(messages.courseMesgs![0]).toMatchObject({ sport: 2, subSport: 8 });
    expect(record.altitude).toBe(3117); // (123.4 + 500) * 5
    expect(record.timestamp).toBe((Date.UTC(2026, 9, 10, 1, 2, 3) - Date.UTC(1989, 11, 31)) / 1000);
    expect(messages.recordMesgs![1].distance).toBe(Math.round(cumulativeDistances(track)[1] * 100));
    expect(messages.lapMesgs![0].totalTimerTime).toBe(Math.round(cumulativeDistances(track).at(-1)! / (12 / 3.6) * 1000));
  });

  it.each([
    ['mtb', 'mountain', 12], ['gravel', 'gravelCycling', 18], ['road', 'road', 25],
  ] as const)('uses the %s sub-sport and configured virtual speed', (profile, subSport, kmh) => {
    // One degree at the equator is about 111,195.08 m (independent distance reference).
    const messages = generate({ profile, resolvedTrack: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }] });
    expect(messages.courseMesgs![0].subSport).toBe(subSport);
    expect(messages.lapMesgs![0].totalDistance).toBeCloseTo(111195.08, 1);
    expect(messages.lapMesgs![0].totalTimerTime).toBeCloseTo(111195.08 / (kmh / 3.6), 2);
  });

  it('brackets route records and distance-ordered course points with timer events', () => {
    const order: number[] = [];
    const messages = generate({ places: [place(track[4], 4), place(track[0], 0), place(track[2], 2)] }, { mesgListener: n => order.push(n) });
    const n = FitProfile.MesgNum;
    expect(order).toEqual([n.FILE_ID, n.COURSE, n.LAP, n.EVENT, n.RECORD, n.COURSE_POINT, n.RECORD, n.RECORD, n.COURSE_POINT, n.RECORD, n.RECORD, n.COURSE_POINT, n.EVENT]);
    expect(messages.eventMesgs).toEqual([
      { timestamp: messages.recordMesgs![0].timestamp, event: 'timer', eventType: 'start', eventGroup: 0 },
      { timestamp: messages.recordMesgs!.at(-1)!.timestamp, event: 'timer', eventType: 'stopDisableAll', eventGroup: 0 },
    ]);
    expect(messages.coursePointMesgs!.map(p => p.name)).toEqual(['峠0', '峠2', '峠4']);
  });

  it('maps passes, peaks and every POI category to SDK enum values and snaps to the nearest record', () => {
    const points = Array.from({ length: 8 }, (_, i) => ({ lat: 35 + i * 0.01, lng: 135 }));
    const places = [place(points[0]), { ...place(points[1], 2), kind: 'peak' as const }];
    const kinds = ['michi', 'conv', 'shop', 'water', 'vend', 'wc'] as const;
    const pois = kinds.map((kind, i) => poi(kind, { lat: points[i + 2].lat, lng: 135.0001 }));
    const input = { resolvedTrack: points, places, pois };
    const messages = generate(input), cps = messages.coursePointMesgs!, raw = generate(input, rawOptions);
    expect(cps.map(p => p.type)).toEqual(['summit', 'summit', 'restArea', 'store', 'store', 'water', 'water', 'toilet']);
    expect(raw.coursePointMesgs!.map(p => p.type)).toEqual([1, 1, 29, 48, 48, 3, 3, 39]);
    expect(cps.map(p => p.name)).toEqual(['峠1', '峠2', 'michi1', 'conv1', 'shop1', 'water1', '自販機', 'wc1']);
    cps.forEach((cp, i) => {
      const record = messages.recordMesgs![i];
      expect(cp).toMatchObject({ timestamp: record.timestamp, positionLat: record.positionLat, positionLong: record.positionLong, distance: record.distance });
    });
  });

  it.each([
    ['花脊峠から鞍馬へ', '花脊峠から'],
    ['1234567890123456', '123456789012345'],
    ['あいうえ😀', 'あいうえ'],
    ['😀😀😀😀', '😀😀😀'],
    ['abc花脊峠から', 'abc花脊峠か'],
    ['峠\0余分', '峠'],
  ])('truncates course and point names on UTF-8 character boundaries: %s', (name, expected) => {
    const messages = generate({ name, places: [{ ...place(track[0]), name }] });
    for (const value of [messages.courseMesgs![0].name!, messages.coursePointMesgs![0].name!]) {
      expect(value).toBe(expected);
      expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(15);
      expect(value).not.toContain('\ufffd');
    }
  });

  it('exports one vending representative without expanding its count, and permits POI omission', () => {
    const grouped = groupVending([poi('vend', track[1], 1, 100), poi('vend', track[2], 2, 200)]);
    expect(grouped).toHaveLength(1);
    const cps = generate({ pois: grouped }).coursePointMesgs!;
    expect(cps).toHaveLength(1);
    expect(cps[0]).toMatchObject({ name: '自販機', type: 'water' });
    expectPosition(cps[0], track[1]);
    expect(generate({ places: [place(track[0])], pois: [] }).coursePointMesgs!.map(p => p.type)).toEqual(['summit']);
  });

  it.each(['michi', 'conv', 'water', 'vend', 'wc'] as const)('retains higher priorities and spreads the remaining slots across %s', kind => {
    const hierarchy = ['summit', 'michi', 'conv', 'water', 'vend', 'wc'] as const;
    const priority = hierarchy.indexOf(kind);
    const points = Array.from({ length: 140 }, (_, i) => ({ lat: 35 + i * 0.001, lng: 135 }));
    const places: Place[] = [], pois: Poi[] = [];
    for (let i = 0; i < 95; i++) {
      const higher = hierarchy[i % priority];
      if (higher === 'summit') places.push(place(points[i], i, i));
      else pois.push(poi(higher, points[i], i, i));
    }
    for (let i = 0; i < 21; i++) pois.push(poi(kind, points[95 + i], i, 95 + i));
    // Lower-priority items must not occupy any slot, even if they occur earlier on the route.
    for (const lower of hierarchy.slice(priority + 1)) if (lower !== 'summit') pois.push(poi(lower, points[0], 999, 0));
    const cps = generate({ resolvedTrack: points, places: places.reverse(), pois: pois.reverse() }).coursePointMesgs!;
    expect(cps).toHaveLength(100);
    const ds = cumulativeDistances(points);
    expect(cps.slice(0, 95).map(p => p.distance)).toEqual(ds.slice(0, 95).map(d => Math.round(d * 100) / 100));
    expect(cps.slice(95).map(p => p.distance)).toEqual([95, 100, 105, 110, 115].map(i => Math.round(ds[i] * 100) / 100));
  });

  it('caps even summits at 100, spreading them across the whole route', () => {
    const points = Array.from({ length: 201 }, (_, i) => ({ lat: 35 + i * 0.001, lng: 135 }));
    const places = points.map((p, i) => place(p, i, i)).reverse();
    const cps = generate({ resolvedTrack: points, places, pois: [poi('michi', points[0])] }).coursePointMesgs!;
    expect(cps).toHaveLength(100);
    expect(cps.every(p => p.type === 'summit')).toBe(true);
    expect(cps[0].name).toBe('峠0');
    expect(cps.at(-1)!.name).toBe('峠200');
    const ids = cps.map(p => Number(p.name!.slice(1)));
    expect(ids.every((id, i) => !i || [2, 3].includes(id - ids[i - 1]))).toBe(true);
  });

  it('treats convenience stores and shops as the same priority and uses the middle for one remaining slot', () => {
    const points = Array.from({ length: 104 }, (_, i) => ({ lat: 35 + i * 0.001, lng: 135 }));
    const places = points.slice(0, 99).map((p, i) => place(p, i, i));
    const pois = points.slice(99).map((p, i) => poi(i % 2 ? 'conv' : 'shop', p, i, 99 + i));
    const cps = generate({ resolvedTrack: points, places, pois: pois.reverse() }).coursePointMesgs!;
    expect(cps).toHaveLength(100);
    expect(cps.at(-1)).toMatchObject({ name: 'shop2', type: 'store' });
  });

  it.each([10_000, 10_001, 20_005])('limits %i track points while preserving endpoints, original distance, altitude and climb totals', count => {
    const points = Array.from({ length: count }, (_, i) => ({ lat: 35 + i * 0.000001, lng: 135 + (i % 2) * 0.00001, ele: 100 + i % 13 }));
    const messages = generate({ resolvedTrack: points, places: [place(points[5001], 1), place(points.at(-1)!, 2)] });
    const records = messages.recordMesgs!;
    expect(records.length).toBeLessThanOrEqual(10_000);
    if (count === 10_000) expect(records).toHaveLength(count);
    else expect(records.length).toBeGreaterThan(9900);
    expectPosition(records[0], points[0]);
    expectPosition(records.at(-1)!, points.at(-1)!);
    const ds = cumulativeDistances(points);
    records.forEach((r, i) => {
      const sourceIndex = Math.round((r.positionLat! * 180 / 2 ** 31 - 35) / 0.000001);
      expect(r.altitude).toBe(points[sourceIndex].ele);
      expect(r.distance).toBeCloseTo(ds[sourceIndex], 2);
      if (i) expect(r.distance!).toBeGreaterThanOrEqual(records[i - 1].distance!);
    });
    expect(records.at(-1)!.distance).toBeCloseTo(ds.at(-1)!, 2);
    const stats = elevationStats(points.map(p => p.ele));
    expect(messages.lapMesgs![0]).toMatchObject({ totalAscent: stats.ascent, totalDescent: stats.descent });
    for (const cp of messages.coursePointMesgs!) expect(records).toContainEqual(expect.objectContaining({ positionLat: cp.positionLat, positionLong: cp.positionLong, timestamp: cp.timestamp, distance: cp.distance }));
  });

  it('does not allocate extra records across large gaps or repeated coordinates', () => {
    const points = Array.from({ length: 10_001 }, (_, i) => ({ lat: i < 5000 ? 35 : 36, lng: 135 }));
    const records = generate({ resolvedTrack: points }).recordMesgs!;
    expect(records.length).toBeLessThanOrEqual(10_000);
    expectPosition(records[0], points[0]);
    expectPosition(records.at(-1)!, points.at(-1)!);
    expect(records.at(-1)!.distance).toBeCloseTo(111195.08, 1);
  });

  it('omits missing/nonfinite altitudes without bridging gaps in the ascent calculation', () => {
    const elevations = [100, 110, null, 500, 510, undefined, NaN, Infinity, -25.4];
    const points = elevations.map((ele, i) => ({ lat: 35 + i * 0.001, lng: 135, ele }));
    const messages = generate({ resolvedTrack: points });
    messages.recordMesgs!.forEach((record, i) => {
      if (Number.isFinite(elevations[i])) expect(record.altitude).toBeCloseTo(elevations[i]!, 1);
      else expect(record).not.toHaveProperty('altitude');
    });
    expect(messages.lapMesgs![0]).toMatchObject({ totalAscent: 20, totalDescent: 0 });
  });

  it('handles empty, single-point and entirely stationary tracks without invented positions', () => {
    const empty = generate({ resolvedTrack: [], places: [place(track[0])] });
    expect(empty.courseMesgs).toHaveLength(1);
    expect(empty.recordMesgs ?? []).toEqual([]);
    expect(empty.lapMesgs ?? []).toEqual([]);
    expect(empty.coursePointMesgs ?? []).toEqual([]);
    for (const points of [[{ lat: 35, lng: 135 }], Array.from({ length: 10_001 }, () => ({ lat: 35, lng: 135 }))]) {
      const messages = generate({ resolvedTrack: points });
      expect(messages.recordMesgs!.length).toBeLessThanOrEqual(2);
      expect(messages.lapMesgs![0]).toMatchObject({ totalDistance: 0, totalTimerTime: 0, totalAscent: 0, totalDescent: 0 });
      expect(messages.recordMesgs!.every(r => r.altitude === undefined && r.distance === 0)).toBe(true);
    }
  });

  it('uses along-route distance to disambiguate coincident records on an out-and-back route', () => {
    const points = [track[0], track[1], track[2], track[1], track[0]];
    const ds = cumulativeDistances(points);
    const cp = generate({ resolvedTrack: points, places: [place(track[1], 1, ds[3])] }).coursePointMesgs![0];
    expect(cp.distance).toBeCloseTo(ds[3], 2);
  });

  it('supports southern/western coordinates and wraps the +180 degree meridian', () => {
    const points = [{ lat: -35, lng: -135, ele: -100 }, { lat: -36, lng: 180, ele: 0 }];
    const records = generate({ resolvedTrack: points }).recordMesgs!;
    expectPosition(records[0], points[0]);
    expect(records[1].positionLong).toBe(-2147483648);
    expect(records[0].altitude).toBe(-100);
  });

  it('is deterministic with caller-supplied metadata and does not mutate input', () => {
    const input = structuredClone({ ...defaults, places: [place(track[3]), place(track[1])], pois: [poi('vend', track[2])] });
    const before = structuredClone(input);
    expect(generateFitCourse(input)).toEqual(generateFitCourse(input));
    expect(input).toEqual(before);
  });

  it('rejects invalid metadata instead of silently encoding an invalid uint32z serial or timestamp', () => {
    for (const serialNumber of [0, -1, 2 ** 32, 1.5, NaN]) expect(() => generateFitCourse({ ...defaults, serialNumber })).toThrow(/serial/);
    for (const timeCreated of [new Date(NaN), new Date('1980-01-01')]) expect(() => generateFitCourse({ ...defaults, timeCreated })).toThrow(/time/);
  });
});
