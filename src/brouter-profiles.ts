import road from './brouter-profiles/road-jp.brf?raw';
import gravel from './brouter-profiles/gravel-jp.brf?raw';
import roadSide from './brouter-profiles/road-jp-side.brf?raw';
import gravelSide from './brouter-profiles/gravel-jp-side.brf?raw';
import mtb from './brouter-profiles/mtb-jp.brf?raw';
import trekking from './brouter-profiles/trekking-jp.brf?raw';
import { CONFIG } from './config';

const sources: Record<string, string> = { 'road-jp': road, 'gravel-jp': gravel, 'road-jp-side': roadSide, 'gravel-jp-side': gravelSide, 'mtb-jp': mtb, 'trekking-jp': trekking };
const validId = (id: unknown): id is string => typeof id === 'string' && /^custom_\d+$/.test(id);
const storageKey = (key: string) => `brouter-profile:${key}`;

export class ProfileRegistry {
  private ids = new Map<string, string>();
  private pending = new Map<string, Promise<string>>();
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}

  id(key: string): Promise<string> {
    if (!Object.hasOwn(sources, key)) return Promise.reject(new Error(`Unknown profile: ${key}`));
    const pending = this.pending.get(key);
    if (pending) return pending;
    let id = this.ids.get(key);
    if (!id) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey(key)) ?? 'null');
        if (saved?.source === sources[key] && validId(saved.id)) id = saved.id;
      } catch { /* Storage may be unavailable or corrupt. */ }
    }
    if (id) { this.ids.set(key, id); return Promise.resolve(id); }
    const registration = this.register(key).then(id => {
      // An invalidated, older registration must not overwrite a newer one.
      if (this.pending.get(key) === registration) {
        this.ids.set(key, id);
        try { sessionStorage.setItem(storageKey(key), JSON.stringify({ id, source: sources[key] })); } catch { /* Memory cache remains usable. */ }
      }
      return id;
    }).finally(() => {
      if (this.pending.get(key) === registration) this.pending.delete(key);
    });
    this.pending.set(key, registration);
    return registration;
  }

  invalidate(key: string, expiredId?: string): void {
    // Concurrent failures for the same old ID share the replacement registration.
    if (expiredId !== undefined && this.ids.get(key) !== expiredId) return;
    this.ids.delete(key);
    this.pending.delete(key);
    try { sessionStorage.removeItem(storageKey(key)); } catch { /* Storage is optional. */ }
  }

  private async register(key: string): Promise<string> {
    const response = await this.request('https://brouter.de/brouter/profile', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: sources[key],
      signal: AbortSignal.timeout(CONFIG.routing.timeoutMs),
    });
    if (!response.ok) throw new Error(`BRouter profile ${response.status}`);
    const json = await response.json();
    if (!validId(json?.profileid)) throw new Error('Invalid BRouter profile ID');
    return json.profileid;
  }
}
