import type { Profile } from './config';
export interface Point { lat: number; lng: number; ele?: number | null }
export type LegMode = 'road' | 'gsi' | 'straight';
export const LEG_MODE_LABELS: Record<LegMode, string> = { road: '道に沿う', gsi: '地理院の道', straight: '直線' };
export interface RouteState { name: string; points: Point[]; profile: Profile; legProfiles: Profile[]; legMode: LegMode[]; mode: LegMode; importedTrack?: Point[]; importedPlaces?: Place[] }
export interface Segment { points: Point[]; fallback: boolean; profileUsed?: string; standardProfile?: boolean; gsi?: boolean; gsiRescue?: boolean; error?: string }
export interface Place extends Point { id: number; name: string; kind: 'pass' | 'peak'; routeDistance: number; offset: number; elevationSource: 'OSM' | 'DEM' | 'unknown' }

export interface Poi extends Point { id: string; kind: import('./osm').PoiKind; name: string; hours?: string; routeDistance: number; offset: number; count: number }
