import L from 'leaflet';
import type { Point } from '../types';
import { nearestSegment } from './route-segment';

export interface DragRoute { shapes: Point[][]; points: Point[]; revision: number; enabled: boolean }
export function installRouteDrag(map: L.Map, line: L.Polyline, getRoute: () => DragRoute, insert: (index: number, point: Point) => void,
  live?: { update: (index: number, point: Point) => void; cancel: () => void }) {
  const container = map.getContainer();
  let gesture: { id: number; x: number; y: number; point: Point; route: DragRoute; index: number; touch: boolean; active: boolean; moved: boolean; pan: boolean; zoom: boolean } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, suppressClickUntil = 0;
  const preview = L.polyline([], { color: 'var(--route)', weight: 4, opacity: 0.6, dashArray: '6 8', interactive: false });
  const dot = L.circleMarker([0, 0], { radius: 7, weight: 2, color: 'var(--route)', fillColor: '#fff', fillOpacity: 1, interactive: false, className: 'route-handle' });
  const position = (e: PointerEvent): Point => { const p = map.mouseEventToLatLng(e); return { lat: p.lat, lng: p.lng }; };
  const draw = () => {
    const g = gesture!;
    if (live) live.update(g.index + 1, g.point);
    else preview.setLatLngs([g.route.points[g.index], g.point, g.route.points[g.index + 1]].map(p => [p.lat, p.lng])).addTo(map);
    dot.setLatLng([g.point.lat, g.point.lng]).addTo(map);
  };
  const activate = () => {
    const g = gesture; if (!g || getRoute().revision !== g.route.revision) { cancel(); return; }
    g.active = true; map.dragging.disable(); map.touchZoom.disable();
    container.setPointerCapture(g.id); container.classList.add('route-dragging');
    if (g.touch) draw();
  };
  const cancel = () => {
    clearTimeout(timer); const g = gesture; gesture = undefined; preview.remove(); dot.remove(); container.classList.remove('route-dragging');
    if (g) live?.cancel();
    if (g?.active) {
      if (container.hasPointerCapture(g.id)) container.releasePointerCapture(g.id);
      if (g.pan) map.dragging.enable(); if (g.zoom) map.touchZoom.enable();
      if (g.moved || g.touch) suppressClickUntil = Date.now() + 500;
    }
  };
  const down = (e: PointerEvent) => {
    if (gesture) { cancel(); return; }
    if (e.button !== 0 || e.isPrimary === false || e.target !== line.getElement()) return;
    const route = { ...getRoute() }; if (!route.enabled || route.points.length >= 200) return;
    const point = position(e), index = nearestSegment(route.shapes, point); if (index < 0 || index + 1 >= route.points.length) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, point, route, index, touch: e.pointerType !== 'mouse', active: false, moved: false, pan: map.dragging.enabled(), zoom: map.touchZoom.enabled() };
    if (gesture.touch) timer = setTimeout(activate, 400);
    else { e.preventDefault(); e.stopPropagation(); activate(); }
  };
  const move = (e: PointerEvent) => {
    const g = gesture;
    if (!g) {
      const route = getRoute();
      if (e.pointerType !== 'mouse' || e.target !== line.getElement() || !route.enabled || route.points.length >= 200) { dot.remove(); return; }
      const point = nearestRoutePoint(map, route.shapes, position(e));
      if (point) dot.setLatLng([point.lat, point.lng]).addTo(map); else dot.remove();
      return;
    }
    if (e.pointerId !== g.id) return;
    if (getRoute().revision !== g.route.revision) { cancel(); return; }
    const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y) > (g.touch ? 8 : 4);
    if (!g.active) { if (moved) cancel(); return; }
    e.preventDefault(); e.stopPropagation(); g.moved ||= moved;
    if (g.moved || g.touch) { g.point = position(e); draw(); }
  };
  const end = (e: PointerEvent) => {
    const g = gesture; if (!g || g.id !== e.pointerId) return;
    const commit = e.type === 'pointerup' && g.active && (g.moved || g.touch) && getRoute().revision === g.route.revision;
    if (g.active && (g.moved || g.touch)) { e.preventDefault(); e.stopPropagation(); }
    const point = position(e); cancel();
    if (commit) insert(g.index + 1, point);
  };
  const click = (e: MouseEvent) => {
    if ((e.target as Element).closest('.map-ui, .leaflet-control')) return;
    if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
  const context = (e: MouseEvent) => { if (gesture) e.preventDefault(); };
  const leave = () => { if (!gesture) dot.remove(); };
  container.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, { capture: true, passive: false });
  document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
  container.addEventListener('click', click, true);
  container.addEventListener('contextmenu', context);
  container.addEventListener('pointerleave', leave);
  document.addEventListener('keydown', key); window.addEventListener('blur', cancel);
  return { cancel, dispose: () => {
    cancel(); container.removeEventListener('pointerdown', down, true); container.removeEventListener('click', click, true); container.removeEventListener('contextmenu', context);
    container.removeEventListener('pointerleave', leave);
    document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', end, true); document.removeEventListener('pointercancel', end, true);
    document.removeEventListener('keydown', key); window.removeEventListener('blur', cancel);
  } };
}

/** Project in screen space so the handle sits on the visible Leaflet line. */
export function nearestRoutePoint(map: L.Map, shapes: Point[][], point: Point): Point | undefined {
  const cursor = map.latLngToLayerPoint([point.lat, point.lng]);
  let best: L.Point | undefined, offset = Infinity;
  for (const shape of shapes) for (let i = 1; i < shape.length; i++) {
    const a = map.latLngToLayerPoint([shape[i - 1].lat, shape[i - 1].lng]);
    const b = map.latLngToLayerPoint([shape[i].lat, shape[i].lng]);
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / length)) : 0;
    const p = L.point(a.x + t * dx, a.y + t * dy), d = p.distanceTo(cursor);
    if (d < offset) { offset = d; best = p; }
  }
  if (!best) return;
  const result = map.layerPointToLatLng(best);
  return { lat: result.lat, lng: result.lng };
}
