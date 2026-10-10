import { expect, it, vi } from 'vitest';
import { nearestOnRoute, distance } from './geo';
import { filterPlaces, parseEle, PlaceProvider, type OsmNode } from './places';
const route = [{ lat: 35, lng: 135 }, { lat: 35.02, lng: 135 }];
it('projects onto segment interior and endpoint and handles empty/duplicate lines', () => {
  const result = nearestOnRoute({ lat: 35.01, lng: 135.001 }, route);
  expect(result.offset).toBeCloseTo(91.1, 0);
  expect(result.routeDistance).toBeCloseTo(distance(route[0], route[1]) / 2, 1);
  expect(nearestOnRoute({ lat: 34, lng: 135 }, route).routeDistance).toBe(0);
  expect(nearestOnRoute(route[0], [])).toEqual({ offset: Infinity, routeDistance: 0 });
  expect(nearestOnRoute(route[0], [route[0], route[0]]).offset).toBe(0);
});
it('filters by separate pass and peak thresholds, deduplicates, sorts', () => {
  const nodes: OsmNode[] = [
    { id: 2, lat: 35.015, lon: 135, tags: { natural: 'peak', name: '山', ele: '500 m' } },
    { id: 1, lat: 35.005, lon: 135.0013, tags: { natural: 'saddle', name: '遠い峠' } },
    { id: 3, lat: 35.005, lon: 135.0013, tags: { natural: 'peak', name: '近い山' } },
  ];
  expect(filterPlaces(nodes, route).map(p => p.id)).toEqual([3, 2]);
  expect(filterPlaces([...nodes, nodes[0]], route)).toHaveLength(2);
  expect(parseEle('500 ft')).toBeNull(); expect(parseEle('0')).toBe(0);
});
it('caches bbox results but refilters for each route', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ elements: [] })));
  const provider = new PlaceProvider(fetcher);
  await provider.get(route); await provider.get(route);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('uses the shared response while preserving place radii and filtering cached nodes for the original line', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 35.01, lon: 135.001, tags: { mountain_pass: 'yes', name: '峠' } },
    { type: 'node', id: 2, lat: 35.01, lon: 135.001, tags: { shop: 'convenience' } },
  ] })));
  const provider = new PlaceProvider(fetcher);
  expect((await provider.get(route)).map(p => p.id)).toEqual([1]);
  const bent = [route[0], { lat: 35.01, lng: 134.9998 }, route[1]];
  expect(await provider.get(bent)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
