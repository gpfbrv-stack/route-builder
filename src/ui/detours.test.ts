// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { DetourSuggestions } from './detours';
import { StatusMessages } from './status';
import { History } from '../state';
import type { Detour } from '../routing';
import type { RouteState } from '../types';

function setup() {
  document.body.innerHTML = '<div id="status"><i></i><span></span></div><ul id="list"><li data-waypoint="0"></li><li data-waypoint="1"></li></ul>';
  const statusElement = document.getElementById('status')!, list = document.getElementById('list')!;
  const state: RouteState = { name: 'test', points: [{ lat: 35, lng: 135 }, { lat: 35.01, lng: 135 }, { lat: 35.02, lng: 135 }], profile: 'mtb', mode: 'road', legProfiles: ['mtb', 'road'], legMode: ['road', 'road'] };
  const history = new History(state), status = new StatusMessages(statusElement);
  const router = { detour: vi.fn(async (): Promise<Detour | undefined> => ({ key: 'first', osmM: 4500, gsiM: 1200 })) };
  const ui = new DetourSuggestions(router, status, list, () => history.value, next => { history.set(next); ui.clear(); });
  const segments = state.points.slice(1).map((p, i) => ({ points: [state.points[i], p], fallback: false }));
  return { ui, router, history, state, status, statusElement, list, segments };
}
it.each(['status', 'list'])('switches one leg from %s and Undo restores it', async target => {
  const s = setup();
  await s.ui.scan(s.state, s.segments.slice(0, 1));
  expect(s.statusElement.textContent).toContain('区間 1→2: 地理院の道なら 1.2km(OSM 4.5km)');
  expect(s.list.textContent).toContain('地理院の方が短い');
  expect(s.history.canUndo).toBe(false);
  (target === 'status' ? s.statusElement : s.list).querySelector('button')!.click();
  expect(s.history.value.legMode).toEqual(['gsi', 'road']);
  expect(s.history.value.legProfiles).toEqual(['mtb', 'road']);
  expect(s.list.querySelector('button')).toBeNull();
  s.history.undo(); expect(s.history.value).toEqual(s.state); expect(s.history.canUndo).toBe(false);
});
it('switches all suggested legs in one history entry', async () => {
  const s = setup(); await s.ui.scan(s.state, s.segments);
  expect(s.statusElement.textContent).toContain('2区間で地理院の道の方が短く引けます');
  expect(s.statusElement.querySelector('button')!.textContent).toBe('すべて切り替える');
  s.statusElement.querySelector('button')!.click();
  expect(s.history.value.legMode).toEqual(['gsi', 'gsi']);
  s.history.undo(); expect(s.history.value).toEqual(s.state); expect(s.history.canUndo).toBe(false);
});
it.each(['close', 'edit'])('clears on %s and does not repeat the same result', async action => {
  const s = setup(); await s.ui.scan(s.state, s.segments.slice(0, 1));
  if (action === 'close') s.statusElement.querySelectorAll('button')[1].click(); else s.ui.clear();
  await s.ui.scan(s.state, s.segments);
  expect(s.statusElement.textContent).toBe(''); expect(s.list.textContent).toBe('');
  s.router.detour.mockResolvedValue({ key: 'changed-result', osmM: 4600, gsiM: 1100 });
  await s.ui.scan(s.state, s.segments.slice(0, 1)); expect(s.list.textContent).toContain('地理院の方が短い');
});
it('ignores late comparison results after an edit', async () => {
  const s = setup(); let resolve!: (value: Detour) => void;
  s.router.detour.mockImplementation(() => new Promise(done => { resolve = done; }));
  const scan = s.ui.scan(s.state, s.segments); s.ui.clear();
  resolve({ key: 'late', osmM: 4500, gsiM: 1200 }); await scan;
  expect(s.router.detour).toHaveBeenCalledTimes(1); expect(s.list.textContent).toBe('');
});
it('does not start comparisons when settings change before BRouter finishes', async () => {
  const s = setup(), current = s.ui.current(); s.ui.clear();
  await s.ui.scan(s.state, s.segments, current);
  expect(s.router.detour).not.toHaveBeenCalled();
});
it('preserves warnings while allowing the suggestion action when they clear', async () => {
  const s = setup(); s.status.set('other', 'warning', 'warn');
  await s.ui.scan(s.state, s.segments.slice(0, 1));
  expect(s.statusElement.textContent).toBe('warning'); expect(s.list.querySelector('button')).not.toBeNull();
  s.status.set('other', '');
  expect(s.statusElement.classList.contains('warn')).toBe(false);
  s.statusElement.querySelector('button')!.click(); expect(s.history.value.legMode[0]).toBe('gsi');
});
