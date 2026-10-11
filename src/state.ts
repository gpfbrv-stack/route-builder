import { DEFAULT_LEG_MODES, type Profile } from './config';
import type { LegMode, LegPrefer, Point, RouteState, Segment } from './types';

export function legPreferences(state: RouteState): LegPrefer[] {
  return state.points.slice(1).map((_, i) => state.legPrefer?.[i] ?? 'main');
}
export function supportsPreference(state: RouteState, index: number): boolean {
  return state.legMode[index] === 'road' && (state.legProfiles[index] === 'road' || state.legProfiles[index] === 'gravel');
}
export function preferLeg(state: RouteState, index: number, prefer: LegPrefer): RouteState {
  if (!supportsPreference(state, index)) return state;
  const legPrefer = legPreferences(state); legPrefer[index] = prefer;
  return { ...state, legPrefer };
}

/** Called only for a committed waypoint edit, using its first routing result. */
export function autoPreferWaypoint(state: RouteState, index: number, segments: Segment[]): RouteState {
  if (state.importedTrack || index < 0 || index >= state.points.length) return state;
  const adjacent = [index - 1, index].filter(i => supportsPreference(state, i));
  const highways = adjacent.flatMap(i => {
    const segment = segments[i];
    if (!segment || segment.fallback || segment.gsi || segment.brouterRescue) return [];
    const highway = i === index ? segment.startHighway : segment.endHighway;
    return highway ? [highway] : [];
  });
  if (!highways.length) return state;
  // At a junction the two legs can disagree; a side-road endpoint is enough evidence.
  const prefer: LegPrefer = highways.some(h => !/^(trunk|primary|secondary)(_link)?$/.test(h)) ? 'side' : 'main';
  const legPrefer = legPreferences(state);
  if (adjacent.every(i => legPrefer[i] === prefer)) return state;
  adjacent.forEach(i => { legPrefer[i] = prefer; });
  return { ...state, legPrefer };
}

export function defaultLegMode(profile: Profile): LegMode {
  try {
    const saved = localStorage.getItem(`route-builder:leg-mode:${profile}`);
    if (saved === 'road' || saved === 'gsi' || saved === 'straight') return saved;
  } catch { /* Storage may be unavailable. */ }
  return DEFAULT_LEG_MODES[profile];
}
export function selectMode(state: RouteState, mode: LegMode): RouteState {
  try { localStorage.setItem(`route-builder:leg-mode:${state.profile}`, mode); }
  catch { /* The selection still works without persistence. */ }
  return { ...state, mode };
}

/** Insertion inside a leg splits its profile; appending uses the current selection. */
export function insertWaypoint(state: RouteState, index: number, point: Point): RouteState {
  const points = [...state.points], legProfiles = [...state.legProfiles], legMode = [...state.legMode];
  const legPrefer = legPreferences(state);
  points.splice(index, 0, point);
  if (state.points.length) legPrefer.splice(Math.max(0, index - 1), 0,
    index === state.points.length ? 'main' : legPrefer[Math.max(0, index - 1)] ?? 'main');
  if (state.points.length) legMode.splice(Math.max(0, index - 1), 0,
    index === state.points.length ? state.mode : state.legMode[Math.max(0, index - 1)] ?? state.mode);
  if (state.points.length) legProfiles.splice(Math.max(0, index - 1), 0,
    index === state.points.length ? state.profile : state.legProfiles[Math.max(0, index - 1)] ?? state.profile);
  return { ...state, points, legProfiles, legMode, legPrefer };
}
export function removeWaypoint(state: RouteState, index: number): RouteState {
  const points = state.points.filter((_, i) => i !== index), legProfiles = [...state.legProfiles], legMode = [...state.legMode];
  const legPrefer = legPreferences(state);
  // Removing an interior point retains the incoming leg's profile.
  legProfiles.splice(Math.min(index, legProfiles.length - 1), 1);
  legMode.splice(Math.min(index, legMode.length - 1), 1);
  legPrefer.splice(Math.min(index, legPrefer.length - 1), 1);
  return { ...state, points, legProfiles, legMode, legPrefer };
}
export function selectProfile(state: RouteState, profile: Profile): RouteState { return { ...state, profile, mode: defaultLegMode(profile) }; }
export function reprofile(state: RouteState, index?: number): RouteState {
  return { ...state, legProfiles: state.legProfiles.map((profile, i) => index === undefined || i === index ? state.profile : profile),
    legMode: state.legMode.map((mode, i) => index === undefined || i === index ? state.mode : mode) };
}
export class History {
  private past: RouteState[] = [];
  constructor(public value: RouteState) {}
  set(next: RouteState) { this.past.push(structuredClone(this.value)); if (this.past.length > 50) this.past.shift(); this.value = structuredClone(next); }
  undo() { const previous = this.past.pop(); if (previous) this.value = previous; }
  get canUndo() { return this.past.length > 0; }
}
