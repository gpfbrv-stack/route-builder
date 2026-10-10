// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { layoutChartLabels, labelWidth, type ChartLabel } from './chart-labels';
import { drawChart } from '../chart';
import type { Poi } from '../types';

it('stacks colliding names into three rows and prioritizes passes over peaks', () => {
  const labels: ChartLabel[] = [
    { name: '山頂', routeDistance: 500, kind: 'peak' },
    ...['花脊峠', '旧花背峠', '杉ノ峠'].map(name => ({ name, routeDistance: 500, kind: 'pass' as const })),
  ];
  const result = layoutChartLabels(labels, 1000, 360);
  expect(result[0].row).toBeNull();
  expect(result.slice(1).map(p => p.row)).toEqual([0, 1, 2]);
  expect(labels[0].name).toBe('山頂');
});

it('keeps estimated text boxes inside both edges with no overlap in any row', () => {
  expect(labelWidth('花脊峠')).toBe(33);
  const labels = Array.from({ length: 30 }, (_, i) => ({ name: i % 2 ? '長い名前の峠' : '山頂', routeDistance: i / 29 * 1000 }));
  const result = layoutChartLabels(labels, 1000, 343).filter(p => p.row !== null);
  for (const p of result) {
    expect(p.textX - p.textWidth / 2).toBeGreaterThanOrEqual(4);
    expect(p.textX + p.textWidth / 2).toBeLessThanOrEqual(339);
    for (const q of result) if (p !== q && p.row === q.row) {
      expect(Math.abs(p.textX - q.textX)).toBeGreaterThanOrEqual((p.textWidth + q.textWidth) / 2 + 6);
    }
  }
});

it('leaves only a marker for a name wider than the graph and handles empty input', () => {
  expect(layoutChartLabels([], 0, 360)).toEqual([]);
  expect(layoutChartLabels([{ name: '峠'.repeat(100), routeDistance: 0 }], 0, 343)[0].row).toBeNull();
});

const samples = [{ lat: 35, lng: 135, distance: 0, ele: 100 }, { lat: 35.3, lng: 135, distance: 30000, ele: 200 }];
const poi: Poi = { id: '1', name: '店', kind: 'conv', lat: 35, lng: 135, routeDistance: 5000, offset: 0, count: 1 };
it('draws the exact-threshold gap below grade fill and colored POI dots above it', () => {
  const container = document.createElement('div');
  drawChart(container, samples, () => {}, [], [poi], { from: 5000, to: 25000 });
  const svg = container.querySelector('svg')!;
  expect(svg.firstElementChild!.getAttribute('class')).toBe('chart-gap');
  expect(svg.querySelector('.chart-gap')!.getAttribute('fill')).toBe('var(--gap-bg)');
  expect(Number(svg.querySelector('.chart-gap')!.getAttribute('width'))).toBeCloseTo(316 * 2 / 3);
  const dot = svg.querySelector('.chart-poi')!;
  expect(dot.getAttribute('fill')).toBe('var(--poi-conv)');
  expect(dot.getAttribute('r')).toBe('4'); expect(dot.getAttribute('stroke')).toBe('#fff');
  expect([...svg.children].indexOf(dot)).toBeGreaterThan([...svg.children].indexOf(svg.querySelector('polygon')!));
  drawChart(container, samples, () => {}, [], [], { from: 0, to: 19999 });
  expect(container.querySelector('.chart-gap,.chart-poi')).toBeNull();
});

it('keeps all pass markers, fits three rows above the plot and retains keyboard readout', () => {
  const container = document.createElement('div'), hover = vi.fn();
  drawChart(container, samples, hover, Array.from({ length: 4 }, (_, i) => ({ name: `花脊峠${i}`, routeDistance: 15000 })));
  expect(container.querySelectorAll('.chart-place-marker')).toHaveLength(4);
  expect(container.querySelectorAll('.chart-place-label')).toHaveLength(3);
  expect([...container.querySelectorAll('.chart-place-label')].map(n => n.getAttribute('y'))).toEqual(['10', '24', '38']);
  const svg = container.querySelector('svg')!;
  svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
  expect(hover).toHaveBeenLastCalledWith(samples[1]);
  expect(container.querySelector('output')!.textContent).toContain('30.0 km');
});
