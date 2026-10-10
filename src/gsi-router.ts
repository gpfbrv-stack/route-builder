import { cacheSet, RequestQueue } from './async';
import { distance, validPoint } from './geo';
import type { Point, Segment } from './types';

const ZOOM_SIZE = 2 ** 16;
const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;
const MAX_LAT = 85.05112878;
const TILE_LIMIT = 120;
const CACHE_LIMIT = 400;
const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;
type Current = () => boolean;
type Lines = Point[][];
interface Edge { a: number; b: number }
interface Graph { nodes: Point[]; edges: Edge[] }
interface Snap { edge: number; t: number; point: Point }

function checkCurrent(isCurrent: Current) {
  if (!isCurrent()) throw new DOMException('経路計算を中止しました', 'AbortError');
}

function tileKeys(a: Point, b: Point): string[] {
  const margin = Math.max(400, distance(a, b) * 0.3);
  const latMargin = margin / EARTH_RADIUS / RAD;
  const south = Math.max(-MAX_LAT, Math.min(a.lat, b.lat) - latMargin);
  const north = Math.min(MAX_LAT, Math.max(a.lat, b.lat) + latMargin);
  const lngMargin = latMargin / Math.cos(Math.max(Math.abs(south), Math.abs(north)) * RAD);
  const tileX = (lng: number) => Math.max(0, Math.min(ZOOM_SIZE - 1, Math.floor((lng + 180) / 360 * ZOOM_SIZE)));
  const tileY = (lat: number) => Math.max(0, Math.min(ZOOM_SIZE - 1,
    Math.floor((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * ZOOM_SIZE)));
  const west = tileX(Math.min(a.lng, b.lng) - lngMargin);
  const east = tileX(Math.max(a.lng, b.lng) + lngMargin);
  const top = tileY(north), bottom = tileY(south);
  if ((east - west + 1) * (bottom - top + 1) > TILE_LIMIT) {
    throw new Error('区間が長すぎます。途中に経由点を追加してください');
  }
  const keys: string[] = [];
  for (let x = west; x <= east; x++) for (let y = top; y <= bottom; y++) keys.push(`${x}/${y}`);
  return keys;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseTile(value: unknown): Lines {
  if (!record(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error('地理院の道路データが不正です');
  }
  const lines: Lines = [];
  for (const feature of value.features) {
    if (!record(feature)) throw new Error('地理院の道路データが不正です');
    // Text attributes in this dataset are garbled. Only the motorway flag excludes roads.
    if (record(feature.properties) && feature.properties.motorway === 1) continue;
    const geometry = feature.geometry;
    if (!record(geometry)) continue;
    if (geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') continue;
    const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(parts)) throw new Error('地理院の道路データが不正です');
    for (const part of parts) {
      if (!Array.isArray(part)) throw new Error('地理院の道路データが不正です');
      const points: Point[] = part.map(coordinate => {
        if (!Array.isArray(coordinate) || coordinate.length < 2) throw new Error('地理院の道路座標が不正です');
        const point: Point = { lng: coordinate[0], lat: coordinate[1] };
        if (!validPoint(point)) throw new Error('地理院の道路座標が不正です');
        return point;
      });
      if (points.length >= 2) lines.push(points);
    }
  }
  return lines;
}

function buildGraph(tiles: Lines[]): Graph {
  const nodes: Point[] = [], edges: Edge[] = [];
  const ids = new Map<string, number>(), endpoints = new Set<number>();
  for (const lines of tiles) for (const line of lines) {
    const vertices = line.map(point => {
      const lat = Math.round(point.lat * 1e6), lng = Math.round(point.lng * 1e6);
      const key = `${lat},${lng}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = nodes.length;
        nodes.push({ lat: lat / 1e6, lng: lng / 1e6 }); ids.set(key, id);
      }
      return id;
    });
    endpoints.add(vertices[0]); endpoints.add(vertices[vertices.length - 1]);
    for (let i = 1; i < vertices.length; i++) edges.push({ a: vertices[i - 1], b: vertices[i] });
  }

  const parents = nodes.map((_, i) => i);
  const root = (id: number): number => {
    while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id]; }
    return id;
  };
  // 2 m Cartesian cells on the earth's sphere avoid an all-pairs endpoint search.
  const cells = new Map<string, number[]>();
  for (const id of endpoints) {
    const p = nodes[id], lat = p.lat * RAD, lng = p.lng * RAD;
    const x = Math.floor(EARTH_RADIUS * Math.cos(lat) * Math.cos(lng) / 2);
    const y = Math.floor(EARTH_RADIUS * Math.cos(lat) * Math.sin(lng) / 2);
    const z = Math.floor(EARTH_RADIUS * Math.sin(lat) / 2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
        if (distance(p, nodes[other]) <= 2) {
          const a = root(id), b = root(other);
          parents[Math.max(a, b)] = Math.min(a, b);
        }
      }
    }
    const key = `${x},${y},${z}`;
    const bucket = cells.get(key) ?? [];
    bucket.push(id); cells.set(key, bucket);
  }
  const unique = new Set<string>(), merged: Edge[] = [];
  for (const edge of edges) {
    const a = root(edge.a), b = root(edge.b);
    if (a === b) continue;
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (!unique.has(key)) { unique.add(key); merged.push({ a, b }); }
  }
  return { nodes, edges: merged };
}

function snap(point: Point, graph: Graph): Snap {
  let best: Snap | undefined, nearest = Infinity;
  graph.edges.forEach((edge, index) => {
    const a = graph.nodes[edge.a], b = graph.nodes[edge.b];
    const k = Math.cos((a.lat + b.lat + point.lat) / 3 * RAD);
    const ax = (a.lng - point.lng) * k, ay = a.lat - point.lat;
    const dx = (b.lng - a.lng) * k, dy = b.lat - a.lat;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
    const projected = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
    const offset = distance(point, projected);
    if (offset < nearest) { nearest = offset; best = { edge: index, t, point: projected }; }
  });
  if (!best || nearest > 300) throw new Error('近くに地理院の道がありません');
  return best;
}

interface Step { node: number; cost: number; estimate: number }
class MinHeap {
  private entries: Step[] = [];
  push(entry: Step) {
    let i = this.entries.length;
    this.entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.entries[parent].estimate <= entry.estimate) break;
      this.entries[i] = this.entries[parent]; i = parent;
    }
    this.entries[i] = entry;
  }
  pop(): Step | undefined {
    if (!this.entries.length) return undefined;
    const first = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.entries.length && this.entries[child + 1].estimate < this.entries[child].estimate) child++;
        if (last.estimate <= this.entries[child].estimate) break;
        this.entries[i] = this.entries[child]; i = child;
      }
      this.entries[i] = last;
    }
    return first;
  }
}

function shortestPath(graph: Graph, start: Snap, end: Snap, isCurrent: Current): Point[] {
  const { nodes, edges } = graph;
  const splits = new Map<number, { t: number; node: number }[]>();
  const insert = (projection: Snap) => {
    const edge = edges[projection.edge];
    if (projection.t === 0) return edge.a;
    if (projection.t === 1) return edge.b;
    const node = nodes.length;
    nodes.push(projection.point);
    const list = splits.get(projection.edge) ?? [];
    list.push({ t: projection.t, node }); splits.set(projection.edge, list);
    return node;
  };
  // Insert both projections together: two points on the same edge must connect directly.
  const source = insert(start), target = insert(end);
  const neighbours: { node: number; weight: number }[][] = nodes.map(() => []);
  edges.forEach((edge, index) => {
    const cuts = (splits.get(index) ?? []).sort((a, b) => a.t - b.t);
    const chain = [edge.a, ...cuts.map(cut => cut.node), edge.b];
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i], weight = distance(nodes[a], nodes[b]);
      neighbours[a].push({ node: b, weight }); neighbours[b].push({ node: a, weight });
    }
  });
  const costs = new Float64Array(nodes.length).fill(Infinity);
  const previous = new Int32Array(nodes.length).fill(-1);
  const queue = new MinHeap();
  costs[source] = 0;
  queue.push({ node: source, cost: 0, estimate: distance(nodes[source], nodes[target]) });
  let step: Step | undefined;
  while ((step = queue.pop())) {
    checkCurrent(isCurrent);
    if (step.cost !== costs[step.node]) continue;
    if (step.node === target) {
      const path: Point[] = [];
      for (let id = target; id !== -1; id = previous[id]) path.push(nodes[id]);
      return path.reverse();
    }
    for (const next of neighbours[step.node]) {
      const cost = step.cost + next.weight;
      if (cost < costs[next.node]) {
        costs[next.node] = cost; previous[next.node] = step.node;
        queue.push({ node: next.node, cost, estimate: cost + distance(nodes[next.node], nodes[target]) });
      }
    }
  }
  throw new Error('地理院の道がつながっていません');
}

export class GsiRouter {
  private cache = new Map<string, Lines>();
  private pending = new Map<string, { promise: Promise<Lines>; consumers: Current[] }>();
  private queue = new RequestQueue(CONCURRENCY);
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}

  private tile(key: string, isCurrent: Current): Promise<Lines> {
    const cached = this.cache.get(key);
    if (cached) {
      cacheSet(this.cache, key, cached, CACHE_LIMIT);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(key);
    if (pending) { pending.consumers.push(isCurrent); return pending.promise; }
    const consumers = [isCurrent];
    const promise = this.queue.run(async () => {
      checkCurrent(() => consumers.some(current => current()));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('地理院タイルの取得がタイムアウトしました', 'TimeoutError')), TIMEOUT_MS);
      try {
        const response = await this.request(`https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/${key}.geojson`, { signal: controller.signal });
        if (response.status !== 404 && !response.ok) throw new Error(`地理院タイルを取得できませんでした (${response.status})`);
        const lines = response.status === 404 ? [] : parseTile(await response.json());
        cacheSet(this.cache, key, lines, CACHE_LIMIT);
        return lines;
      } finally { clearTimeout(timer); }
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, { promise, consumers });
    return promise;
  }

  /** Obsolete callers reject with AbortError; already running shared tile requests may finish and populate the cache. */
  async route(a: Point, b: Point, isCurrent: Current = () => true): Promise<Segment> {
    checkCurrent(isCurrent);
    if (!validPoint(a) || !validPoint(b)) throw new Error('経路の座標が不正です');
    const keys = tileKeys(a, b), tiles: Lines[] = [];
    let next = 0, failed = false;
    const active = () => !failed && isCurrent();
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, async () => {
      try {
        while (next < keys.length) {
          checkCurrent(active);
          const index = next++;
          tiles[index] = await this.tile(keys[index], active);
          checkCurrent(active);
        }
      } catch (error) { failed = true; throw error; }
    }));
    checkCurrent(isCurrent);
    const graph = buildGraph(tiles);
    const start = snap(a, graph), end = snap(b, graph);
    const path = shortestPath(graph, start, end, isCurrent);
    checkCurrent(isCurrent);
    return { points: [a, ...path, b], fallback: false };
  }
}
