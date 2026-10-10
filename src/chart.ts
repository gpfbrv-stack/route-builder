import type { Sample } from './elevation';
export interface ChartLabel { name: string; routeDistance: number }
export function drawChart(container: HTMLElement, samples: Sample[], onHover: (sample: Sample | null) => void, labels: ChartLabel[] = []) {
  container.replaceChildren();
  const values = samples.flatMap(s => s.ele === null ? [] : [s.ele]);
  if (!values.length) { container.textContent = '標高データはまだありません。'; onHover(null); return; }
  const low = Math.floor(Math.min(...values) / 50) * 50;
  const high = Math.max(low + 50, Math.ceil(Math.max(...values) / 50) * 50);
  const total = samples.at(-1)!.distance || 1;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 360 216'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '標高プロファイル 横軸km 縦軸m');
  const create = (tag: string, attrs: Record<string, string>, text?: string) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text; svg.append(node); return node;
  };
  const x = (d: number) => 48 + d / total * 296;
  const y = (e: number) => 170 - (e - low) / (high - low) * 112;
  for (let i = 0; i <= 2; i++) {
    const value = low + (high - low) * i / 2;
    create('line', { x1: '48', x2: '344', y1: String(y(value)), y2: String(y(value)), stroke: '#ddd' });
    create('text', { x: '40', y: String(y(value) + 4), 'text-anchor': 'end' }, String(Math.round(value)));
  }
  create('text', { x: '8', y: '40' }, 'm');
  create('text', { x: '48', y: '192' }, '0');
  create('text', { x: '344', y: '192', 'text-anchor': 'end' }, `${(total / 1000).toFixed(2)} km`);
  let d = '', open = false;
  for (const sample of samples) {
    if (sample.ele === null) { open = false; continue; }
    d += `${open ? 'L' : 'M'}${x(sample.distance).toFixed(1)} ${y(sample.ele).toFixed(1)} `; open = true;
  }
  create('path', { d, fill: 'none', stroke: '#0017c1', 'stroke-width': '2' });
  labels.forEach((label, i) => {
    const xx = x(label.routeDistance);
    create('line', { x1: String(xx), x2: String(xx), y1: '48', y2: '170', stroke: '#7f7f7f', 'stroke-dasharray': '3 3' });
    const node = create('text', { x: String(Math.min(300, Math.max(48, xx))), y: String(16 + (i % 3) * 14) }, label.name);
    const title = document.createElementNS(ns, 'title'); title.textContent = label.name; node.append(title);
  });
  const cursor = create('line', { x1: '48', x2: '48', y1: '48', y2: '170', stroke: '#b14c00', visibility: 'hidden' });
  const readout = document.createElement('output'); readout.className = 'chart-readout'; readout.textContent = 'グラフをなぞると地図で位置を確認できます。';
  const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = String(samples.length - 1); range.value = '0'; range.setAttribute('aria-label', '標高グラフの位置');
  const select = (i: number) => {
    const sample = samples[Math.min(samples.length - 1, Math.max(0, i))];
    const xx = String(x(sample.distance)); cursor.setAttribute('x1', xx); cursor.setAttribute('x2', xx); cursor.setAttribute('visibility', 'visible');
    readout.textContent = `${(sample.distance / 1000).toFixed(2)} km · ${sample.ele === null ? '標高不明' : Math.round(sample.ele) + ' m'}`;
    range.value = String(i); onHover(sample);
  };
  svg.onpointermove = event => { const bounds = svg.getBoundingClientRect(); const d = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 360 - 48) / 296)); select(Math.round(d * (samples.length - 1))); };
  svg.onpointerleave = () => { cursor.setAttribute('visibility', 'hidden'); onHover(null); };
  range.oninput = () => select(Number(range.value));
  container.append(svg, range, readout);
}
