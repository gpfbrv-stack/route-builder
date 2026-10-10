import { CONFIG } from './config';
import { validPoint } from './geo';
import type { Point, RouteState } from './types';
const STORAGE_KEY = 'route-builder:v1';
export function validateState(value: unknown): RouteState {
  const s = value as RouteState;
  if (!s || typeof s.name !== 'string' || s.name.length > 200 || !Object.hasOwn(CONFIG.profiles, s.profile) || typeof s.followRoad !== 'boolean' || !Array.isArray(s.points) || s.points.length > 200 || !s.points.every(p => p && validPoint(p))) throw new Error('ルートデータの形式が不正です');
  if (s.importedTrack && (!Array.isArray(s.importedTrack) || s.importedTrack.length > 100000 || !s.importedTrack.every(p => p && validPoint(p) && (p.ele == null || Number.isFinite(p.ele))))) throw new Error('GPXの点データが不正です');
  if (s.importedPlaces && (!Array.isArray(s.importedPlaces) || s.importedPlaces.length > 10000 || !s.importedPlaces.every(p => p && validPoint(p) && typeof p.name === 'string' && Number.isFinite(p.routeDistance) && Number.isFinite(p.offset) && Number.isFinite(p.id) && (p.kind === 'pass' || p.kind === 'peak') && (p.ele == null || Number.isFinite(p.ele))))) throw new Error('GPX地物の形式が不正です');
  return { name: s.name, profile: s.profile, followRoad: s.followRoad, points: s.points.map(cleanPoint), ...(s.importedTrack ? { importedTrack: s.importedTrack.map(cleanPoint), importedPlaces: s.importedPlaces } : {}) };
}
function cleanPoint(p: Point): Point { return { lat: p.lat, lng: p.lng, ...(Number.isFinite(p.ele) ? { ele: p.ele } : {}) }; }
export function encodeRoute(state: RouteState): string {
  const s = validateState({ ...state, importedTrack: undefined, importedPlaces: undefined });
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, ...s }));
  return '#route=' + btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decodeRoute(hash: string): RouteState {
  if (!hash.startsWith('#route=') || hash.length > 50000) throw new Error('共有URLの形式が不正です');
  try {
    const bytes = Uint8Array.from(atob(hash.slice(7).replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (data.v !== 1) throw new Error('version');
    return validateState(data);
  } catch { throw new Error('共有URLを読み込めませんでした'); }
}
export function saveRoute(state: RouteState): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateState(state))); return true; } catch { return false; }
}
export function loadRoute(): RouteState | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? validateState(JSON.parse(raw)) : null; } catch { return null; }
}
