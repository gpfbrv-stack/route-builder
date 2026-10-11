import type { Profile } from './config';
export type Surface = 'paved' | 'unpaved' | 'unknown';
// Surface describes the edge arriving at this point. Missing data means unknown.
export interface Point { lat: number; lng: number; ele?: number | null; surface?: Surface }
export type LegMode = 'road' | 'gsi' | 'straight';
export type LegPrefer = 'main' | 'side';
export const LEG_MODE_LABELS: Record<LegMode, string> = { road: '道に沿う', gsi: '地理院の道', straight: '直線' };
// Legacy callers (including GPX import) may omit legPrefer; state/storage boundaries fill main.
export interface RouteState { name: string; points: Point[]; profile: Profile; legProfiles: Profile[]; legMode: LegMode[]; legPrefer?: LegPrefer[]; mode: LegMode; importedTrack?: Point[]; importedPlaces?: Place[] }
export interface Segment { points: Point[]; fallback: boolean; profileUsed?: string; standardProfile?: boolean; gsi?: boolean; gsiRescue?: boolean; brouterRescue?: boolean; error?: string; startHighway?: string; endHighway?: string }
export interface Place extends Point { id: number; name: string; kind: 'pass' | 'peak'; routeDistance: number; offset: number; elevationSource: 'OSM' | 'DEM' | 'unknown' }

export interface Poi extends Point { id: string; kind: import('./osm').PoiKind; name: string; hours?: string; routeDistance: number; offset: number; count: number }
