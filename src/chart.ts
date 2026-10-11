import type { Sample } from './elevation';
import { elevationAt, gradeBins, gradeColor } from './grade';
import { CONFIG } from './config';
import type { Poi } from './types';
import { layoutChartLabels, type ChartLabel } from './ui/chart-labels';
import { surfaceAt, SURFACE_LABELS, type SurfaceSpan } from './surface';
import type { ChartMode } from './ui/chart-mode';
export type { ChartLabel } from './ui/chart-labels';
export function drawChart(container: HTMLElement, samples: Sample[], onHover: (sample: Sample | null) => void, labels: ChartLabel[] = [], pois: Poi[] = [], gap: { from: number; to: number } | null = null, mode: ChartMode = 'surface', surfaces: SurfaceSpan[] = []) {
  container.replaceChildren(); onHover(null);
  const values = samples.flatMap(s => s.ele === null ? [] : [s.ele]);
  if (!values.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '標高データはまだありません。'; container.append(empty); return; }
  const low = Math.floor(Math.min(...values) / 100) * 100, high = Math.max(low + 100, Math.ceil(Math.max(...values) / 100) * 100);
  const total = samples.at(-1)!.distance || 1, W = container.clientWidth || 360, H = 168;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('tabindex', '0'); svg.setAttribute('role', 'slider');
  svg.setAttribute('aria-label', '標高グラフの位置（左右キーで移動）'); svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('aria-valuemax', String(samples.length - 1)); svg.setAttribute('aria-valuenow', '0');
  const create = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text) node.textContent = text; svg.append(node); return node;
  };
  const laidOut = layoutChartLabels(labels, total, W);
  const top = 22 + Math.max(0, ...laidOut.map(label => label.row ?? 0)) * 14;
  const x = (d: number) => 36 + d / total * (W - 44), y = (e: number) => top + (1 - (e - low) / (high - low)) * (146 - top);
  if (gap && gap.to - gap.from >= CONFIG.poi.gapWarnKm * 1000) {
    const from = Math.max(0, Math.min(total, gap.from)), to = Math.max(from, Math.min(total, gap.to));
    create('rect', { class: 'chart-gap', x: x(from), y: top, width: x(to) - x(from), height: 146 - top, fill: 'var(--gap-bg)' });
  }
  for (let e = low; e <= high; e += 100) {
    create('line', { x1: 36, x2: W - 8, y1: y(e), y2: y(e), stroke: '#e6e6e6' });
    create('text', { x: 30, y: y(e) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#666' }, String(e));
  }
  for (let d = 0; d <= total; d += 5000) create('text', { x: x(d), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#666' }, String(d / 1000));
  create('text', { x: W - 8, y: H - 6, 'text-anchor': 'end', 'font-size': 11, fill: '#666' }, 'km');
  const bins = gradeBins(samples);
  let si = 0;
  for (const bin of mode === 'grade' ? bins : []) {
    while (si < samples.length && samples[si].distance < bin.from) si++;
    let end = si; while (end < samples.length && samples[end].distance <= bin.to) end++;
    if (bin.grade !== null) {
      const points = [`${x(bin.from)},${y(low)}`, `${x(bin.from)},${y(elevationAt(samples, bin.from)!)}`];
      for (let i = si; i < end; i++) points.push(`${x(samples[i].distance)},${y(samples[i].ele!)}`);
      points.push(`${x(bin.to)},${y(elevationAt(samples, bin.to)!)}`, `${x(bin.to)},${y(low)}`);
      create('polygon', { points: points.join(' '), fill: gradeColor(bin.grade) });
    }
    si = end;
  }
  if (mode === 'surface') {
    const spans = surfaces.length ? surfaces : [{ from: 0, to: total, surface: 'unknown' as const }];
    let index = 0;
    let fill: SurfaceSpan['surface'] = 'unknown', fromEdge = 0, toEdge = 0, topPoints: string[] = [];
    const flush = () => {
      if (topPoints.length) create('polygon', { points: `${x(fromEdge)},${y(low)} ${topPoints.join(' ')} ${x(toEdge)},${y(low)}`, fill: `var(--surf-${fill})` });
      topPoints = [];
    };
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (a.ele === null || b.ele === null) { flush(); continue; }
      if (b.distance <= a.distance) continue;
      while (index < spans.length && spans[index].to <= a.distance) index++;
      for (let j = index; j < spans.length && spans[j].from < b.distance; j++) {
        const span = spans[j], from = Math.max(a.distance, span.from), to = Math.min(b.distance, span.to);
        if (to <= from) continue;
        const at = (d: number) => a.ele! + (b.ele! - a.ele!) * (d - a.distance) / (b.distance - a.distance);
        if (topPoints.length && (fill !== span.surface || toEdge !== from)) flush();
        if (!topPoints.length) { fill = span.surface; fromEdge = from; topPoints.push(`${x(from)},${y(at(from))}`); }
        topPoints.push(`${x(to)},${y(at(to))}`); toEdge = to;
      }
    }
    flush();
  }
  let d = '', open = false;
  for (const sample of samples) { if (sample.ele === null) { open = false; continue; } d += `${open ? 'L' : 'M'}${x(sample.distance)} ${y(sample.ele)} `; open = true; }
  create('path', { d, fill: 'none', stroke: '#1a1a1a', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
  laidOut.forEach(({ label, x: xx, textX, row }) => {
    create('line', { x1: xx, x2: xx, y1: top - 8, y2: 146, stroke: '#1a1a1a', 'stroke-dasharray': '2 3' });
    const marker = create('path', { class: 'chart-place-marker', d: `M${xx - 5} ${top - 8} L${xx + 5} ${top - 8} L${xx} ${top - 2}Z`, fill: '#1a1a1a' });
    const markerTitle = document.createElementNS(ns, 'title'); markerTitle.textContent = label.name; marker.append(markerTitle);
    if (row === null) return;
    const text = create('text', { class: 'chart-place-label', x: textX, y: 10 + row * 14, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700 }, label.name);
    const title = document.createElementNS(ns, 'title'); title.textContent = label.name; text.append(title);
  });
  for (const poi of pois) create('circle', { class: 'chart-poi', cx: x(poi.routeDistance), cy: 143, r: 4, fill: CONFIG.poi.categories[poi.kind].color, stroke: '#fff', 'stroke-width': 1.5 });
  const cursor = create('line', { x1: 36, x2: 36, y1: top, y2: 146, stroke: '#1a1a1a', visibility: 'hidden' });
  const dot = create('circle', { r: 4, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 2, visibility: 'hidden' });
  const readout = document.createElement('output'); readout.className = 'readout num';
  let index = 0;
  const select = (i: number) => {
    index = Math.max(0, Math.min(samples.length - 1, i)); const sample = samples[index], xx = x(sample.distance);
    cursor.setAttribute('x1', String(xx)); cursor.setAttribute('x2', String(xx)); cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', sample.ele === null ? 'hidden' : 'visible'); dot.setAttribute('cx', String(xx)); dot.setAttribute('cy', String(y(sample.ele ?? low)));
    const grade = bins.find(b => sample.distance >= b.from && sample.distance <= b.to)?.grade ?? null;
    readout.textContent = `${(sample.distance / 1000).toFixed(1)} km · ${sample.ele === null ? '—' : Math.round(sample.ele)} m · ${grade === null ? '—' : `${grade >= 0 ? '+' : ''}${grade.toFixed(1)}`}% · ${SURFACE_LABELS[surfaceAt(surfaces, sample.distance)]}`;
    const half = Math.min(W / 2, readout.offsetWidth / 2 || 140);
    readout.style.left = `${Math.max(half, Math.min(W - half, xx))}px`; readout.style.visibility = 'visible';
    svg.setAttribute('aria-valuenow', String(index)); svg.setAttribute('aria-valuetext', readout.textContent); onHover(sample);
  };
  const hide = () => { cursor.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); readout.style.visibility = 'hidden'; onHover(null); };
  const point = (event: PointerEvent) => {
    const bounds = svg.getBoundingClientRect(), distance = Math.max(0, Math.min(total, ((event.clientX - bounds.left) / bounds.width * W - 36) / (W - 44) * total));
    let lo = 0, hi = samples.length - 1; while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].distance < distance) lo = mid + 1; else hi = mid; } select(lo);
  };
  svg.onpointermove = point; svg.onpointerdown = point; svg.onpointerleave = hide; svg.onblur = hide; svg.onfocus = () => select(index);
  svg.onkeydown = event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); select(event.key === 'Home' ? 0 : event.key === 'End' ? samples.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1)); } };
  container.append(svg, readout);
}
