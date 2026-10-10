// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type L from 'leaflet';
import { History } from '../state';
import { installRouteDrag, type DragRoute } from './route-drag';
vi.mock('leaflet', () => {
  const layer = () => ({ setLatLngs: vi.fn().mockReturnThis(), setLatLng: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() });
  return { default: { polyline: layer, circleMarker: layer } };
});
let dispose: () => void;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { dispose?.(); vi.useRealTimers(); });
function setup(enabled = true) {
  document.body.innerHTML = '<div id="map"><svg><path/></svg></div>';
  const element = document.getElementById('map')!, path = element.querySelector('path')!;
  element.setPointerCapture = vi.fn(); element.releasePointerCapture = vi.fn(); element.hasPointerCapture = () => true;
  const handler = () => { let on = true; return { enabled: () => on, disable: vi.fn(() => { on = false; }), enable: vi.fn(() => { on = true; }) }; };
  const map = { getContainer: () => element, mouseEventToLatLng: (e: MouseEvent) => ({ lat: e.clientY / 100, lng: e.clientX / 100 }), dragging: handler(), touchZoom: handler() };
  const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 2, lng: 2 }];
  const history = new History({ name: 'test', points, profile: 'mtb', legProfiles: points.slice(1).map(() => 'mtb'), followRoad: false });
  const route: DragRoute = { points, shapes: [[points[0], points[1]], [points[1], points[2]]], revision: 0, enabled };
  const insert = vi.fn((index, point) => { const next = [...history.value.points]; next.splice(index, 0, point); history.set({ ...history.value, points: next }); });
  const drag = installRouteDrag(map as unknown as L.Map, { getElement: () => path } as unknown as L.Polyline, () => route, insert); dispose = drag.dispose;
  const pointer = (type: string, x: number, y: number, touch = false) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
    Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: touch ? 'touch' : 'mouse' }, isPrimary: { value: true } });
    (type === 'pointerdown' ? path : document).dispatchEvent(e);
  };
  return { pointer, map, route, history, insert, element };
}
describe('route drag lifecycle', () => {
  it('inserts in the start segment only on release and undo restores once', () => {
    const { pointer, insert, history, element } = setup();
    pointer('pointerdown', 100, 0); pointer('pointermove', 210, 100); expect(insert).not.toHaveBeenCalled();
    pointer('pointerup', 210, 100); expect(insert).toHaveBeenCalledExactlyOnceWith(1, { lat: 1, lng: 2.1 }); expect(history.value.points).toHaveLength(4);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true }); element.dispatchEvent(click); expect(click.defaultPrevented).toBe(true);
    history.undo(); expect(history.value.points).toHaveLength(3); expect(history.canUndo).toBe(false);
  });
  it('allows normal touch panning before the long press threshold', () => {
    const { pointer, insert, map } = setup(); pointer('pointerdown', 100, 0, true); vi.advanceTimersByTime(200); pointer('pointermove', 120, 20, true); vi.advanceTimersByTime(500); pointer('pointerup', 120, 20, true);
    expect(map.dragging.disable).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it('starts after 400ms and restores map gestures on completion', () => {
    const { pointer, insert, map } = setup(); pointer('pointerdown', 100, 0, true); vi.advanceTimersByTime(399); expect(map.dragging.enabled()).toBe(true);
    vi.advanceTimersByTime(1); expect(map.dragging.enabled()).toBe(false); pointer('pointermove', 110, 10, true); pointer('pointerup', 110, 10, true);
    expect(insert).toHaveBeenCalledOnce(); expect(map.dragging.enabled()).toBe(true); expect(map.touchZoom.enabled()).toBe(true);
  });
  it('ignores imported tracks, simple clicks, cancellation and stale revisions', () => {
    let test = setup(false); test.pointer('pointerdown', 100, 0); test.pointer('pointermove', 110, 10); test.pointer('pointerup', 110, 10); expect(test.insert).not.toHaveBeenCalled(); dispose();
    test = setup(); test.pointer('pointerdown', 100, 0); test.pointer('pointerup', 100, 0); expect(test.insert).not.toHaveBeenCalled();
    test.pointer('pointerdown', 100, 0); test.pointer('pointermove', 110, 10); test.pointer('pointercancel', 110, 10); expect(test.insert).not.toHaveBeenCalled();
    test.pointer('pointerdown', 100, 0); test.pointer('pointermove', 110, 10); test.route.revision++; test.pointer('pointerup', 110, 10); expect(test.insert).not.toHaveBeenCalled();
  });
});
