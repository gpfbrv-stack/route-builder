import { Encoder, Profile as FitProfile } from '@garmin/fitsdk';
import type { CourseMesg, CoursePointMesg, Encodable, EventMesg, FileIdMesg, LapMesg, Mesg, RecordMesg } from '@garmin/fitsdk';
import { CONFIG, type Profile } from './config';
import { elevationStats } from './elevation';
import { cumulativeDistances, distance } from './geo';
import type { Place, Poi, Point } from './types';

export interface FitCourseInput {
  name: string;
  profile: Profile;
  resolvedTrack: Point[];
  places?: Place[];
  /** Visible, already grouped representatives (e.g. poiUI.exportPois). Empty when POI export is off. */
  pois?: Poi[];
  /** The caller supplies the creation time and random nonzero uint32 serial to keep this function pure. */
  timeCreated: Date;
  serialNumber: number;
}

const MAX_RECORDS = 10_000;
const MAX_COURSE_POINTS = 100;
const subSports = { mtb: 'mountain', gravel: 'gravelCycling', road: 'road' } as const;
// Enum names are resolved to the numeric FIT values by Encoder using profile.js.
const poiTypes = { michi: 'restArea', conv: 'store', shop: 'store', water: 'water', vend: 'water', wc: 'toilet' } as const;
const priorities = { michi: 1, conv: 2, shop: 2, water: 3, vend: 4, wc: 5 };
const utf8 = new TextEncoder();

function fitName(name: string): string {
  let result = '', bytes = 0;
  for (const char of name) {
    if (char === '\0') break; // FIT strings are NUL-terminated.
    const size = utf8.encode(char).length;
    if (bytes + size > 15) break;
    result += char; bytes += size;
  }
  return result;
}

function semicircles(degrees: number): number {
  // +180 and -180 share a meridian; +2^31 does not fit in sint32.
  return Math.round(degrees * 2 ** 31 / 180) | 0;
}

function recordIndices(distances: number[]): number[] {
  if (distances.length <= MAX_RECORDS) return distances.map((_, i) => i);
  const last = distances.length - 1, total = distances[last];
  if (total === 0) return [0, last];
  const step = total / (MAX_RECORDS - 1), indices = [0];
  let next = step;
  for (let i = 1; i < last && indices.length < MAX_RECORDS - 1; i++) {
    if (distances[i] < next) continue;
    indices.push(i);
    next = (Math.floor(distances[i] / step) + 1) * step;
  }
  indices.push(last);
  return indices;
}

interface Candidate {
  point: Place | Poi;
  name: string;
  type: CoursePointMesg['type'];
  priority: number;
}

function selectCoursePoints(places: Place[], pois: Poi[]): Candidate[] {
  const candidates: Candidate[] = [
    ...places.map(point => ({ point, name: point.name, type: 'summit' as const, priority: 0 })),
    ...pois.map(point => ({ point, name: point.kind === 'vend' ? '自販機' : point.name, type: poiTypes[point.kind], priority: priorities[point.kind] })),
  ];
  const selected: Candidate[] = [];
  for (let priority = 0; priority <= 5 && selected.length < MAX_COURSE_POINTS; priority++) {
    const group = candidates.filter(p => p.priority === priority).sort((a, b) => a.point.routeDistance - b.point.routeDistance);
    const slots = MAX_COURSE_POINTS - selected.length;
    if (group.length <= slots) selected.push(...group);
    else {
      // Spread retained indices across the distance-sorted group, including both ends.
      // When only one slot remains, retain the middle candidate.
      for (let i = 0; i < slots; i++) selected.push(group[slots === 1 ? Math.floor(group.length / 2) : Math.round(i * (group.length - 1) / (slots - 1))]);
    }
  }
  return selected;
}

/** Encode a course without I/O, clock/random access, or mutation of the input. */
export function generateFitCourse(input: FitCourseInput): Uint8Array {
  if (!Number.isFinite(input.timeCreated.getTime()) || input.timeCreated.getTime() < Date.UTC(1989, 11, 31)) throw new Error('Invalid FIT creation time');
  if (!Number.isInteger(input.serialNumber) || input.serialNumber < 1 || input.serialNumber > 0xffffffff) throw new Error('FIT serial number must be a nonzero uint32');
  const encoder = new Encoder(), mesgNum = FitProfile.MesgNum;
  // The SDK writeMesg signature only exposes the base Mesg; check fields against their concrete types here.
  const write = <T extends Mesg>(message: Encodable<T>) => encoder.writeMesg(message);
  const startTime = new Date(Math.floor(input.timeCreated.getTime() / 1000) * 1000);
  write<FileIdMesg>({ mesgNum: mesgNum.FILE_ID, type: 'course', manufacturer: 'development', product: 0, timeCreated: startTime, serialNumber: input.serialNumber });
  write<CourseMesg>({ mesgNum: mesgNum.COURSE, name: fitName(input.name), sport: 'cycling', subSport: subSports[input.profile] });

  const track = input.resolvedTrack;
  // A valid FIT container with metadata only; no invented coordinates for an empty route.
  if (!track.length) return encoder.close();
  const distances = cumulativeDistances(track), totalDistance = distances.at(-1)!;
  const speed = CONFIG.fit.speedKmh[input.profile] / 3.6;
  const totalTime = totalDistance / speed;
  const timestampAt = (d: number) => new Date(startTime.getTime() + Math.round(d / speed) * 1000);
  const endTime = timestampAt(totalDistance), first = track[0], last = track.at(-1)!;
  // Compute totals before thinning so small climbs and bends are not lost.
  const stats = elevationStats(track.map(p => p.ele ?? null), CONFIG.elevation.hysteresisM);
  write<LapMesg>({
    mesgNum: mesgNum.LAP, startTime, timestamp: endTime,
    startPositionLat: semicircles(first.lat), startPositionLong: semicircles(first.lng),
    endPositionLat: semicircles(last.lat), endPositionLong: semicircles(last.lng),
    totalDistance, totalElapsedTime: totalTime, totalTimerTime: totalTime,
    totalAscent: Math.round(stats.ascent), totalDescent: Math.round(stats.descent),
  });

  const indices = recordIndices(distances);
  const records = indices.map(i => ({
    mesgNum: mesgNum.RECORD, timestamp: timestampAt(distances[i]),
    positionLat: semicircles(track[i].lat), positionLong: semicircles(track[i].lng),
    distance: distances[i],
    // Encoder takes physical units (m), applying (altitude + 500) * 5 internally.
    ...(Number.isFinite(track[i].ele) ? { altitude: track[i].ele! } : {}),
  } satisfies Encodable<RecordMesg>));
  const coursePoints = selectCoursePoints(input.places ?? [], input.pois ?? []).map(candidate => {
    let nearest = 0, offset = Infinity, alongOffset = Infinity;
    indices.forEach((trackIndex, recordIndex) => {
      const d = distance(candidate.point, track[trackIndex]);
      const along = Math.abs(distances[trackIndex] - candidate.point.routeDistance);
      // Resolve coincident points on out-and-back routes using the known along-route distance.
      if (d < offset - 1e-6 || (Math.abs(d - offset) <= 1e-6 && along < alongOffset)) {
        nearest = recordIndex; offset = d; alongOffset = along;
      }
    });
    const { timestamp, positionLat, positionLong, distance: d } = records[nearest];
    return { nearest, mesg: {
      mesgNum: mesgNum.COURSE_POINT, timestamp, positionLat, positionLong, distance: d,
      type: candidate.type, name: fitName(candidate.name),
    } satisfies Encodable<CoursePointMesg> };
  }).sort((a, b) => a.nearest - b.nearest);

  write<EventMesg>({ mesgNum: mesgNum.EVENT, timestamp: startTime, event: 'timer', eventType: 'start', eventGroup: 0 });
  let nextPoint = 0;
  records.forEach((record, i) => {
    encoder.writeMesg(record);
    // Keep course points in route order alongside their records, inside the timer events.
    while (nextPoint < coursePoints.length && coursePoints[nextPoint].nearest === i) encoder.writeMesg(coursePoints[nextPoint++].mesg);
  });
  write<EventMesg>({ mesgNum: mesgNum.EVENT, timestamp: endTime, event: 'timer', eventType: 'stopDisableAll', eventGroup: 0 });
  return encoder.close();
}
