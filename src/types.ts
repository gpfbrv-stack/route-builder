import type { Profile } from './config';
export interface Point { lat: number; lng: number; ele?: number | null }
export interface RouteState { name: string; points: Point[]; profile: Profile; followRoad: boolean }
export interface Segment { points: Point[]; fallback: boolean }
