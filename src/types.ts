import type { Profile } from './config';
export interface Point { lat: number; lng: number; ele?: number | null }
export interface RouteState { name: string; points: Point[]; profile: Profile; legProfiles: Profile[]; legFollow: boolean[]; followRoad: boolean; importedTrack?: Point[]; importedPlaces?: Place[] }
export interface Segment { points: Point[]; fallback: boolean; profileUsed?: string; standardProfile?: boolean }
export interface Place extends Point { id: number; name: string; kind: 'pass' | 'peak'; routeDistance: number; offset: number; elevationSource: 'OSM' | 'DEM' | 'unknown' }

export interface Poi extends Point { id: string; kind: import('./osm').PoiKind; name: string; hours?: string; routeDistance: number; offset: number; count: number }
