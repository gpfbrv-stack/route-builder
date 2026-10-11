import { SURFACE_LABELS } from '../surface';

export type ChartMode = 'surface' | 'grade';
const storageKey = 'route-builder:chart-mode';
export function installChartMode(root: ParentNode, onChange: () => void) {
  let mode: ChartMode = 'surface';
  try { if (localStorage.getItem(storageKey) === 'grade') mode = 'grade'; } catch { /* Storage is optional. */ }
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-chart-mode]');
  const legend = root.querySelector<HTMLElement>('#chart-legend')!;
  const render = () => {
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.chartMode === mode)));
    legend.setAttribute('aria-label', mode === 'surface' ? '路面の凡例' : '勾配の凡例');
    const items = mode === 'surface' ? Object.entries(SURFACE_LABELS).map(([key, label]) => [label, `--surf-${key}`])
      : ['〜3%', '3〜6%', '6〜9%', '9〜12%', '12%〜', '下り'].map((label, i) => [label, `--g${['0', '3', '6', '9', '12', 'down'][i]}`]);
    legend.innerHTML = items.map(([label, token]) => `<span><i style="background:var(${token})"></i>${label}</span>`).join('');
  };
  buttons.forEach(button => button.onclick = () => {
    mode = button.dataset.chartMode === 'grade' ? 'grade' : 'surface';
    try { localStorage.setItem(storageKey, mode); } catch { /* Keep the in-memory choice. */ }
    render(); onChange();
  });
  render();
  return { get mode() { return mode; } };
}
