import type { Detour, Router } from '../routing';
import type { RouteState, Segment } from '../types';
import type { StatusMessages } from './status';

/** Suggestions are transient; only an explicit switch changes route history. */
export class DetourSuggestions {
  private generation = 0;
  private dismissed = new Set<string>();
  private suggestions = new Map<number, Detour>();
  constructor(private router: Pick<Router, 'detour'>, private status: StatusMessages,
    private list: HTMLElement, private state: () => RouteState, private change: (state: RouteState) => void) {}

  clear() {
    this.generation++;
    for (const suggestion of this.suggestions.values()) this.dismissed.add(suggestion.key);
    this.suggestions.clear();
    this.render();
  }

  current() {
    const generation = this.generation;
    return () => generation === this.generation;
  }

  async scan(state: RouteState, segments: Segment[], current = this.current()) {
    for (let i = 0; i < segments.length && current(); i++) {
      const suggestion = await this.router.detour(state.points[i], state.points[i + 1], state.legProfiles[i], state.legMode[i], segments[i], current);
      if (!current()) return;
      if (suggestion && !this.dismissed.has(suggestion.key)) {
        this.suggestions.set(i, suggestion); this.render();
      }
    }
  }

  private switch(indices: number[]) {
    const state = this.state();
    const selected = new Set(indices.filter(i => this.suggestions.has(i)));
    if (!selected.size) return;
    this.clear();
    this.change({ ...state, legMode: state.legMode.map((mode, i) => selected.has(i) ? 'gsi' : mode) });
  }

  private button(label: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = label; button.onclick = action; return button;
  }

  private render() {
    this.list.querySelectorAll('.detour-leg').forEach(element => element.remove());
    const entries = [...this.suggestions.entries()];
    if (!entries.length) { this.status.set('detours', ''); return; }
    const content = document.createElement('span'); content.className = 'detour-notice';
    const [index, suggestion] = entries[0];
    content.append(entries.length === 1
      ? `区間 ${index + 1}→${index + 2}: 地理院の道なら ${(suggestion.gsiM / 1000).toFixed(1)}km(OSM ${(suggestion.osmM / 1000).toFixed(1)}km)`
      : `${entries.length}区間で地理院の道の方が短く引けます`);
    content.append(this.button(entries.length === 1 ? '切り替える' : 'すべて切り替える', () => this.switch(entries.map(([i]) => i))),
      this.button('閉じる', () => this.clear()));
    this.status.set('detours', content, 'info');
    for (const [i] of entries) {
      const row = this.list.querySelector<HTMLElement>(`[data-waypoint="${i}"]`);
      if (!row) continue;
      const hint = document.createElement('span'); hint.className = 'detour-leg';
      hint.append('地理院の方が短い', this.button('切り替える', () => this.switch([i])));
      row.append(hint);
    }
  }
}
