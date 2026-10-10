import { CONFIG } from './config';
import { validPoint } from './geo';
import type { LegMode, Point, RouteState } from './types';
const STORAGE_KEY = 'route-builder:v1';
const isMode = (mode: unknown): mode is LegMode => mode === 'road' || mode === 'gsi' || mode === 'straight';
export function validateState(value: unknown): RouteState {
  const s = value as RouteState & { followRoad?: boolean; legFollow?: boolean[] };
  if (!s || typeof s.name !== 'string' || s.name.length > 200 || !Object.hasOwn(CONFIG.profiles, s.profile) || !Array.isArray(s.points) || s.points.length > 200 || !s.points.every(p => p && validPoint(p))) throw new Error('ルートデータの形式が不正です');
  const mode = s.mode === undefined && typeof s.followRoad === 'boolean' ? (s.followRoad ? 'road' : 'straight') : s.mode;
  if (!isMode(mode)) throw new Error('線の引き方が不正です');
  const count = Math.max(0, s.points.length - 1);
  const legProfiles = s.legProfiles === undefined ? Array(count).fill(s.profile) : s.legProfiles;
  if (!Array.isArray(legProfiles) || legProfiles.length !== count || !legProfiles.every(p => typeof p === 'string' && Object.hasOwn(CONFIG.profiles, p))) throw new Error('区間の走り方が不正です');
  if (s.legMode === undefined && s.legFollow !== undefined && (!Array.isArray(s.legFollow) || s.legFollow.length !== count || !s.legFollow.every(f => typeof f === 'boolean'))) throw new Error('区間の道に沿う設定が不正です');
  const legMode = s.legMode === undefined ? s.legFollow?.map(f => f ? 'road' : 'straight') ?? Array(count).fill(mode) : s.legMode;
  if (!Array.isArray(legMode) || legMode.length !== count || !legMode.every(isMode)) throw new Error('区間の線の引き方が不正です');
  if (s.importedTrack && (!Array.isArray(s.importedTrack) || s.importedTrack.length > 100000 || !s.importedTrack.every(p => p && validPoint(p) && (p.ele == null || Number.isFinite(p.ele))))) throw new Error('GPXの点データが不正です');
  if (s.importedPlaces && (!Array.isArray(s.importedPlaces) || s.importedPlaces.length > 10000 || !s.importedPlaces.every(p => p && validPoint(p) && typeof p.name === 'string' && Number.isFinite(p.routeDistance) && Number.isFinite(p.offset) && Number.isFinite(p.id) && (p.kind === 'pass' || p.kind === 'peak') && (p.ele == null || Number.isFinite(p.ele))))) throw new Error('GPX地物の形式が不正です');
  return { name: s.name, profile: s.profile, legProfiles: [...legProfiles], legMode: [...legMode], mode, points: s.points.map(cleanPoint), ...(s.importedTrack ? { importedTrack: s.importedTrack.map(cleanPoint), importedPlaces: s.importedPlaces } : {}) };
}
function cleanPoint(p: Point): Point { return { lat: p.lat, lng: p.lng, ...(Number.isFinite(p.ele) ? { ele: p.ele } : {}) }; }
export function encodeRoute(state: RouteState): string {
  const s = validateState({ ...state, importedTrack: undefined, importedPlaces: undefined });
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 4, ...s }));
  return '#route=' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decodeRoute(hash: string): RouteState {
  if (!hash.startsWith('#route=') || hash.length > 50000) throw new Error('共有URLの形式が不正です');
  try {
    const bytes = Uint8Array.from(atob(hash.slice(7).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (![1, 2, 3, 4].includes(data.v)) throw new Error('version');
    if (data.v >= 2 && !Array.isArray(data.legProfiles)) throw new Error('legProfiles');
    if (data.v === 3 && !Array.isArray(data.legFollow)) throw new Error('legFollow');
    if (data.v === 4 && (!isMode(data.mode) || !Array.isArray(data.legMode))) throw new Error('legMode');
    return validateState({ ...data, ...(data.v === 1 ? { legProfiles: undefined } : {}), ...(data.v < 3 ? { legFollow: undefined } : {}),
      ...(data.v < 4 ? { mode: undefined, legMode: undefined } : {}) });
  } catch { throw new Error('共有URLを読み込めませんでした'); }
}
// Consume a shared snapshot once so subsequent reloads restore the user's edits.
export function consumeSharedRoute(): RouteState | null {
  if (!window.location.hash.startsWith('#route=')) return null;
  const state = decodeRoute(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return state;
}
export function saveRoute(state: RouteState): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateState(state))); return true; } catch { return false; }
}
export function loadRoute(): RouteState | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? validateState(JSON.parse(raw)) : null; } catch { return null; }
}
