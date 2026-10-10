import type { Profile } from './config';
import type { Point, RouteState } from './types';

/** Insertion inside a leg splits its profile; appending uses the current selection. */
export function insertWaypoint(state: RouteState, index: number, point: Point): RouteState {
  const points = [...state.points], legProfiles = [...state.legProfiles], legMode = [...state.legMode];
  points.splice(index, 0, point);
  if (state.points.length) legMode.splice(Math.max(0, index - 1), 0,
    index === state.points.length ? state.mode : state.legMode[Math.max(0, index - 1)] ?? state.mode);
  if (state.points.length) legProfiles.splice(Math.max(0, index - 1), 0,
    index === state.points.length ? state.profile : state.legProfiles[Math.max(0, index - 1)] ?? state.profile);
  return { ...state, points, legProfiles, legMode };
}
export function removeWaypoint(state: RouteState, index: number): RouteState {
  const points = state.points.filter((_, i) => i !== index), legProfiles = [...state.legProfiles], legMode = [...state.legMode];
  // Removing an interior point retains the incoming leg's profile.
  legProfiles.splice(Math.min(index, legProfiles.length - 1), 1);
  legMode.splice(Math.min(index, legMode.length - 1), 1);
  return { ...state, points, legProfiles, legMode };
}
export function selectProfile(state: RouteState, profile: Profile): RouteState { return { ...state, profile }; }
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
