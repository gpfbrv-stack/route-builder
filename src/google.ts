import { CONFIG } from './config';
export type GoogleMapType = 'roadmap' | 'satellite' | 'terrain';
export type GoogleSessionType = GoogleMapType | 'poiOverlay';
export interface GoogleSettings { scale: 'scaleFactor1x' | 'scaleFactor2x'; highDpi: boolean }
export interface GoogleSession { session: string; expiry: string; tileWidth: number; tileHeight: number }
export interface Bounds { north: number; south: number; east: number; west: number }
export interface GoogleViewport { copyright: string; maxZoomRects: (Bounds & { maxZoom: number })[] }
export const GOOGLE = { scale: 'scaleFactor2x', highDpi: true, debounceMs: 400 } as const;
export function sessionValid(session: GoogleSession | null | undefined, nowMs = Date.now()): boolean {
  return !!session && typeof session.session === 'string' && session.session.length > 0 && Number.isFinite(Number(session.expiry)) && Number(session.expiry) * 1000 - 3600000 > nowMs;
}
export function sessionBody(mapType: GoogleSessionType, settings: GoogleSettings = GOOGLE) {
  return { mapType: mapType === 'poiOverlay' ? 'satellite' : mapType, language: 'ja-JP', region: 'JP', scale: settings.scale, highDpi: settings.highDpi,
    ...(mapType === 'terrain' ? { layerTypes: ['layerRoadmap'] } : {}),
    ...(mapType === 'poiOverlay' ? { layerTypes: ['layerRoadmap'], overlay: true, imageFormat: 'png', styles: CONFIG.google.poiOverlayStyles } : {}),
  };
}
export function viewportBounds(bounds: Bounds): Bounds {
  if (!Object.values(bounds).every(Number.isFinite) || bounds.north < bounds.south || bounds.east < bounds.west && bounds.west - bounds.east > 360) throw new Error('Invalid viewport bounds');
  const lat = (v: number) => Math.min(85.05112878, Math.max(-85.05112878, v));
  const lng = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
  // Preserve crossing bounds (west > east); full-world views use almost ±180.
  if (bounds.east - bounds.west >= 360) return { north: lat(bounds.north), south: lat(bounds.south), west: -179.999999, east: 179.999999 };
  return { north: lat(bounds.north), south: lat(bounds.south), west: lng(bounds.west), east: lng(bounds.east) };
}
export function viewportParams(bounds: Bounds, zoom: number) {
  const b = viewportBounds(bounds);
  return new URLSearchParams({ zoom: String(Math.max(0, Math.min(22, Math.floor(zoom)))), north: String(b.north), south: String(b.south), east: String(b.east), west: String(b.west) });
}
// Overlapping regions can advertise different detail levels; prefer the finest
// available at the viewport center, falling back to all regions if none cover it.
export function nativeZoom(viewport: GoogleViewport, center: { lat: number; lng: number }): number {
  const rects = viewport.maxZoomRects?.filter(r => Number.isInteger(r.maxZoom) && r.maxZoom >= 0 && r.maxZoom <= 22);
  if (!rects?.length) throw new Error('Google viewport has no zoom availability');
  const lng = center.lng >= -180 && center.lng <= 180 ? center.lng : ((center.lng + 180) % 360 + 360) % 360 - 180;
  const covering = rects.filter(r => center.lat >= r.south && center.lat <= r.north &&
    (r.west <= r.east ? lng >= r.west && lng <= r.east : lng >= r.west || lng <= r.east));
  return Math.max(...(covering.length ? covering : rects).map(r => r.maxZoom));
}
export function keyFingerprint(key: string) {
  let hash = 2166136261; for (const char of key) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
export class GoogleSessions {
  private memory = new Map<string, GoogleSession>();
  private pending = new Map<string, Promise<GoogleSession>>();
  constructor(private key: string, private settings: GoogleSettings = GOOGLE, private request: typeof fetch = (...args) => fetch(...args)) {}
  get(type: GoogleSessionType): Promise<GoogleSession> {
    const cacheKey = `route-builder:google:${keyFingerprint(this.key)}:${type}:${this.settings.scale}:${this.settings.highDpi}`;
    let session = this.memory.get(cacheKey);
    if (!session) { try { session = JSON.parse(localStorage.getItem(cacheKey) ?? 'null'); } catch { /* storage denied */ } }
    if (sessionValid(session)) { this.memory.set(cacheKey, session!); return Promise.resolve(session!); }
    const running = this.pending.get(cacheKey); if (running) return running;
    const pending = (async () => {
      const response = await this.request(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(this.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sessionBody(type, this.settings)), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Google session HTTP ${response.status}`);
      const data = await response.json() as GoogleSession;
      if (!sessionValid(data) || !(data.tileWidth > 0) || !(data.tileHeight > 0)) throw new Error('Invalid Google session');
      this.memory.set(cacheKey, data);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* memory cache remains available */ }
      return data;
    })().finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, pending); return pending;
  }
}
