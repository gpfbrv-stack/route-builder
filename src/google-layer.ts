import L from 'leaflet';
import { debounce } from './async';
import { GOOGLE, GoogleSessions, nativeZoom, viewportParams, type GoogleMapType, type GoogleSessionType, type GoogleViewport } from './google';
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class GoogleLayer extends L.Layer {
  private activeMap: L.Map | null = null;
  private tiles?: L.TileLayer;
  private retiringTiles = new Set<L.TileLayer>();
  private cancelSwap?: () => void;
  private logo?: L.Control;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private copyright = '';
  private token = '';
  private schedule = debounce(() => { void this.refresh(); }, GOOGLE.debounceMs);
  private moving = () => { this.generation++; this.controller?.abort(); };
  private settled = () => { this.moving(); this.schedule(); };
  constructor(
    private type: GoogleSessionType, private key: string, private sessions: GoogleSessions,
    private notify: (message: string) => void, private fallback: () => void,
    private request: typeof fetch = (...args) => fetch(...args),
  ) { super(); }
  onAdd(map: L.Map): this {
    this.activeMap = map; this.generation++;
    if (this.type === 'poiOverlay') {
      const pane = map.getPane('googlePoi') ?? map.createPane('googlePoi');
      pane.style.zIndex = '250'; pane.style.pointerEvents = 'none';
    }
    const Logo = L.Control.extend({ onAdd() {
      const div = L.DomUtil.create('div', 'google-logo');
      const img = document.createElement('img'); img.src = `${import.meta.env.BASE_URL}google-maps.svg`; img.alt = 'Google Maps'; img.height = 18;
      div.append(img); L.DomEvent.disableClickPropagation(div); return div;
    } });
    this.logo = new Logo({ position: 'bottomleft' }).addTo(map);
    map.on('movestart zoomstart', this.moving).on('moveend zoomend resize', this.settled);
    this.notify(this.type === 'poiOverlay' ? 'Googleの施設・地名を読み込み中…' : 'Google地図を読み込み中…'); void this.refresh(); return this;
  }
  onRemove(map: L.Map): this {
    this.activeMap = null; this.generation++; this.controller?.abort(); clearTimeout(this.timer);
    map.off('movestart zoomstart', this.moving).off('moveend zoomend resize', this.settled);
    this.cancelSwap?.();
    for (const tiles of this.retiringTiles) tiles.remove();
    this.retiringTiles.clear();
    this.tiles?.remove(); this.tiles = undefined; this.logo?.remove();
    if (this.copyright) map.attributionControl.removeAttribution(this.copyright);
    this.copyright = ''; this.token = ''; this.notify(''); return this;
  }
  private async refresh() {
    const map = this.activeMap; if (!map) return;
    if (this.type === 'poiOverlay' && map.getZoom() < 13) { clearTimeout(this.timer); return; }
    const version = ++this.generation;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    try {
      const session = await this.sessions.get(this.type);
      if (version !== this.generation || !this.activeMap) return;
      const bounds = map.getBounds();
      const params = viewportParams({ north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() }, map.getZoom());
      params.set('session', session.session); params.set('key', this.key);
      const response = await this.request(`https://tile.googleapis.com/tile/v1/viewport?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error(`Google viewport HTTP ${response.status}`);
      const viewport = await response.json() as GoogleViewport;
      if (!viewport.copyright || typeof viewport.copyright !== 'string') throw new Error('Missing attribution');
      const maxNativeZoom = nativeZoom(viewport, map.getCenter());
      if (version !== this.generation || !this.activeMap) return;
      const copyright = this.type === 'poiOverlay'
        ? `<span class="google-poi-attribution">Google: ${escapeHtml(viewport.copyright)}（施設・地名）</span>`
        : `背景地図: ${escapeHtml(viewport.copyright)}`;
      if (copyright !== this.copyright) {
        map.attributionControl.addAttribution(copyright);
        if (this.copyright) map.attributionControl.removeAttribution(this.copyright);
        this.copyright = copyright;
      }
      const url = `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(this.key)}`;
      if (!this.tiles || this.tiles.options.maxNativeZoom !== maxNativeZoom || this.token !== session.session) {
        this.cancelSwap?.();
        if (this.tiles) this.retiringTiles.add(this.tiles);
        // HiDPI returns 512px imagery for the SAME geographic tile; CSS stays 256px.
        this.tiles = L.tileLayer(url, { pane: this.type === 'poiOverlay' ? 'googlePoi' : 'tilePane', tileSize: 256, minZoom: this.type === 'poiOverlay' ? 13 : 0, maxZoom: 22, maxNativeZoom, keepBuffer: 0, updateWhenIdle: true, updateWhenZooming: false, detectRetina: false });
        this.tiles.on('tileerror', () => {
          if (!this.activeMap) return;
          if (this.type === 'poiOverlay') this.fail();
          else this.notify('Googleタイルを取得できません。キーの制限・利用枠をご確認ください。');
        });
        if (this.retiringTiles.size) {
          const next = this.tiles;
          const finish = () => {
            this.cancelSwap?.();
            for (const tiles of this.retiringTiles) tiles.remove();
            this.retiringTiles.clear();
          };
          const timeout = setTimeout(finish, 5000);
          this.cancelSwap = () => {
            clearTimeout(timeout); next.off('load', finish); this.cancelSwap = undefined;
          };
          // Subscribe before adding: cached tiles may finish loading immediately.
          next.on('load', finish);
        }
        this.tiles.addTo(map); this.token = session.session;
      }
      if (!this.activeMap) return;
      this.notify(this.type === 'poiOverlay' ? 'Googleの施設・地名を表示中' : 'Google背景を表示中');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.refresh(); }, Math.max(1000, Math.min(86400000, Number(session.expiry) * 1000 - Date.now() - 3600000)));
    } catch (error) {
      if (version !== this.generation || controller.signal.aborted || !this.activeMap) return;
      this.fail(error);
    }
  }
  private fail(error?: unknown) {
    this.activeMap?.removeLayer(this); this.fallback();
    const detail = error instanceof Error ? error.message.match(/HTTP \d{3}$/)?.[0] ?? '' : '';
    this.notify(this.type === 'poiOverlay'
      ? `Googleの施設・地名を表示できません。重ね表示を解除しました。キーの制限・利用枠をご確認ください。${detail}`
      : `Google背景地図を表示できません。地理院地図へ戻しました。${detail}`);
  }
}
export function addGoogleLayers(fallback: () => void, notify: (message: string) => void, key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()): Record<string, L.Layer> {
  if (!key) return {};
  const sessions = new GoogleSessions(key);
  const names: Record<GoogleMapType, string> = { roadmap: 'Google 道路', satellite: 'Google 航空写真', terrain: 'Google 地形' };
  return Object.fromEntries((Object.keys(names) as GoogleMapType[]).map(type => [names[type], new GoogleLayer(type, key, sessions, notify, fallback)]));
}
