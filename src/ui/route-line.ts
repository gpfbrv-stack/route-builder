import L from 'leaflet';
import { Router, segmentKey } from '../routing';
import type { Point, RouteState, Segment } from '../types';

type Leg = { key: string; points: Point[]; pending: boolean; line: L.Polyline; casing: L.Polyline };
const latLngs = (points: Point[]): L.LatLngExpression[] => points.map(p => [p.lat, p.lng]);
const legKey = (state: RouteState, index: number) => segmentKey(state.points[index], state.points[index + 1], state.legProfiles[index], state.legMode[index]);

/** Keep unchanged Leaflet paths, including their routed geometry, across edits. */
export class RouteLine {
  readonly hit = L.polyline([], { weight: 24, opacity: 0, className: 'route-hit', interactive: true });
  private legs: Leg[] = [];
  constructor(private map: L.Map, private router: Router) { this.hit.addTo(map); }
  get shapes() { return this.legs.map(leg => leg.points); }
  update(state: RouteState) {
    const old = [...this.legs];
    const definitions = state.importedTrack
      ? [{ key: `imported:${JSON.stringify(state.importedTrack)}`, points: state.importedTrack, pending: false }]
      : state.points.slice(1).map((b, i) => {
        const a = state.points[i], key = legKey(state, i);
        const cached = state.legMode[i] !== 'straight' ? this.router.cached(a, b, state.legProfiles[i], state.legMode[i]) : undefined;
        const previous = old.find(leg => leg.key === key);
        return { key, points: cached?.points ?? previous?.points ?? [a, b], pending: state.legMode[i] !== 'straight' && !cached && (previous?.pending ?? true) };
      });
    this.legs = definitions.map(def => {
      const index = old.findIndex(leg => leg.key === def.key);
      const leg = index >= 0 ? old.splice(index, 1)[0] : {
        ...def,
        casing: L.polyline([], { color: 'var(--route-casing)', weight: 11, opacity: 0.5, interactive: false }).addTo(this.map),
        line: L.polyline([], { color: 'var(--route)', className: 'route-line', interactive: false }).addTo(this.map),
      };
      if (leg.points !== def.points || leg.pending !== def.pending || index < 0) this.draw(leg, def.points, def.pending);
      return leg;
    });
    old.forEach(leg => { leg.line.remove(); leg.casing.remove(); });
    this.updateHit();
  }
  resolve(index: number, segment: Segment) {
    const leg = this.legs[index];
    if (!leg) return;
    this.draw(leg, segment.points, false); this.updateHit();
  }
  /** A normal request may finish during insertion: match coordinates/profile, not the shifted index. */
  resolveState(state: RouteState, index: number, segment: Segment) {
    const key = legKey(state, index);
    this.legs.forEach(leg => { if (leg.key === key) this.draw(leg, segment.points, false); });
    this.updateHit();
  }
  private draw(leg: Leg, points: Point[], pending: boolean) {
    leg.points = points; leg.pending = pending;
    leg.casing.setLatLngs(pending ? [] : latLngs(points));
    leg.line.setLatLngs(latLngs(points)).setStyle({ weight: pending ? 4 : 6, opacity: pending ? 0.6 : 0.7, dashArray: pending ? '6 8' : undefined });
  }
  private updateHit() { this.hit.setLatLngs(this.shapes.map(latLngs)); this.hit.bringToFront(); }
}
