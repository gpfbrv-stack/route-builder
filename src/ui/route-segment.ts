import { nearestOnRoute } from '../geo';
import type { Point } from '../types';

/** Stable ties choose the earlier segment; distance is to its full routed shape. */
export function nearestSegment(shapes: Point[][], point: Point): number {
  let best = -1, offset = Infinity;
  shapes.forEach((shape, index) => {
    if (shape.length < 2) return;
    const next = nearestOnRoute(point, shape).offset;
    if (next < offset) { best = index; offset = next; }
  });
  return best;
}
