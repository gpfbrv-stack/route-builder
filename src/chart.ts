import type { Sample } from './elevation';
import { elevationAt, gradeBins, gradeColor } from './grade';
export interface ChartLabel { name: string; routeDistance: number }
export function drawChart(container: HTMLElement, samples: Sample[], onHover: (sample: Sample | null) => void, labels: ChartLabel[] = []) {
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
  const x = (d: number) => 36 + d / total * (W - 44), y = (e: number) => 22 + (1 - (e - low) / (high - low)) * 124;
  for (let e = low; e <= high; e += 100) {
    create('line', { x1: 36, x2: W - 8, y1: y(e), y2: y(e), stroke: '#e6e6e6' });
    create('text', { x: 30, y: y(e) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#666' }, String(e));
  }
  for (let d = 0; d <= total; d += 5000) create('text', { x: x(d), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: '#666' }, String(d / 1000));
  create('text', { x: W - 8, y: H - 6, 'text-anchor': 'end', 'font-size': 11, fill: '#666' }, 'km');
  const bins = gradeBins(samples);
  let si = 0;
  for (const bin of bins) {
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
  let d = '', open = false;
  for (const sample of samples) { if (sample.ele === null) { open = false; continue; } d += `${open ? 'L' : 'M'}${x(sample.distance)} ${y(sample.ele)} `; open = true; }
  create('path', { d, fill: 'none', stroke: '#1a1a1a', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
  labels.forEach(label => {
    const xx = x(label.routeDistance);
    create('line', { x1: xx, x2: xx, y1: 14, y2: 146, stroke: '#1a1a1a', 'stroke-dasharray': '2 3' });
    create('path', { d: `M${xx - 5} 14 L${xx + 5} 14 L${xx} 20Z`, fill: '#1a1a1a' });
    const text = create('text', { x: Math.max(60, Math.min(W - 60, xx)), y: 10, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700 }, label.name);
    const title = document.createElementNS(ns, 'title'); title.textContent = label.name; text.append(title);
  });
  const cursor = create('line', { x1: 36, x2: 36, y1: 22, y2: 146, stroke: '#1a1a1a', visibility: 'hidden' });
  const dot = create('circle', { r: 4, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 2, visibility: 'hidden' });
  const readout = document.createElement('output'); readout.className = 'readout num';
  let index = 0;
  const select = (i: number) => {
    index = Math.max(0, Math.min(samples.length - 1, i)); const sample = samples[index], xx = x(sample.distance);
    cursor.setAttribute('x1', String(xx)); cursor.setAttribute('x2', String(xx)); cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', sample.ele === null ? 'hidden' : 'visible'); dot.setAttribute('cx', String(xx)); dot.setAttribute('cy', String(y(sample.ele ?? low)));
    const grade = bins.find(b => sample.distance >= b.from && sample.distance <= b.to)?.grade ?? null;
    readout.textContent = `${(sample.distance / 1000).toFixed(1)} km · ${sample.ele === null ? '—' : Math.round(sample.ele)} m · ${grade === null ? '—' : `${grade >= 0 ? '+' : ''}${grade.toFixed(1)}`}%`;
    readout.style.left = `${Math.max(100, Math.min(W - 100, xx))}px`; readout.style.visibility = 'visible';
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
