// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountUI } from './layout';
import { StatusMessages } from './status';
import { installPopover } from './popover';
import { drawChart } from '../chart';
import { installPanel } from '../panel';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; mountUI(); });
describe('UI controls', () => {
  it('forwards mobile controls to the same actions and profile state', () => {
    expect(document.querySelector('.brand .icon-btn')!.textContent).toBe('');
    const share = document.getElementById('share')!, called = vi.fn(); share.onclick = called;
    document.querySelector<HTMLButtonElement>('#menu-pop [data-action="share"]')!.click(); expect(called).toHaveBeenCalledOnce();
    const profile = document.getElementById('profile') as HTMLSelectElement, change = vi.fn(); profile.onchange = change;
    document.querySelector<HTMLButtonElement>('.m-top [data-profile="road"]')!.click(); expect(profile.value).toBe('road'); expect(change).toHaveBeenCalledOnce();
  });
  it('shows warnings before busy messages, then completion after clearing them', () => {
    const element = document.getElementById('status')!, status = new StatusMessages(element);
    status.set('route', 'done'); status.set('dem', 'sampling', 'busy'); status.set('storage', 'failed', 'warn');
    expect(element.textContent).toBe('failed'); expect(element.className).toBe('status warn');
    status.set('storage', ''); expect(element.textContent).toBe('sampling'); status.set('dem', ''); expect(element.textContent).toBe('done');
  });
  it('opens a keyboard accessible popover and restores focus on Escape', () => {
    const button = document.getElementById('menu-btn') as HTMLButtonElement, pop = document.getElementById('menu-pop')!;
    installPopover(button, pop); button.click(); expect(button.getAttribute('aria-expanded')).toBe('true'); expect(pop.contains(document.activeElement)).toBe(true);
    pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(button.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(button);
  });
  it('cycles all sheet snaps with tap and keyboard', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true })); vi.stubGlobal('innerHeight', 812);
    const handle = document.getElementById('panel-toggle') as HTMLButtonElement;
    installPanel(document.getElementById('panel')!, handle);
    const height = () => document.documentElement.style.getPropertyValue('--sheet-h');
    expect(height()).toBe('168px'); handle.click(); expect(height()).toBe('406px'); handle.click(); expect(height()).toBe('715px'); handle.click(); expect(height()).toBe('168px');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); expect(height()).toBe('406px'); vi.unstubAllGlobals();
  });
  it('follows sheet dragging, snaps to the nearest height and does not cycle on its trailing click', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true })); vi.stubGlobal('innerHeight', 812);
    const handle = document.getElementById('panel-toggle') as HTMLButtonElement;
    handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn(); handle.hasPointerCapture = () => true;
    installPanel(document.getElementById('panel')!, handle);
    const pointer = (type: string, y: number) => { const event = new MouseEvent(type, { clientY: y }); Object.defineProperty(event, 'pointerId', { value: 1 }); handle.dispatchEvent(event); };
    pointer('pointerdown', 650); pointer('pointermove', 220); expect(document.documentElement.style.getPropertyValue('--sheet-h')).toBe('598px');
    pointer('pointerup', 220); handle.click(); expect(document.documentElement.style.getPropertyValue('--sheet-h')).toBe('715px'); vi.unstubAllGlobals();
  });
});
describe('elevation interaction', () => {
  it('moves the map cursor by keyboard and does not bridge missing elevation', () => {
    const container = document.getElementById('chart')!, hover = vi.fn();
    drawChart(container, [{ lat: 35, lng: 135, distance: 0, ele: 100 }, { lat: 35.01, lng: 135, distance: 250, ele: null }, { lat: 35.02, lng: 135, distance: 500, ele: 150 }], hover, [{ name: '<test>', routeDistance: 250 }]);
    const svg = container.querySelector('svg')!; expect(container.querySelector('input')).toBeNull(); expect(svg.getAttribute('tabindex')).toBe('0'); expect(svg.querySelectorAll('polygon')).toHaveLength(0);
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); expect(hover.mock.lastCall?.[0].distance).toBe(250); expect(svg.getAttribute('aria-valuetext')).toContain('— m');
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' })); expect(hover.mock.lastCall?.[0].distance).toBe(500);
    expect(svg.querySelector('test')).toBeNull(); expect(svg.textContent).toContain('<test>');
    svg.dispatchEvent(new FocusEvent('blur')); expect(hover.mock.lastCall?.[0]).toBeNull();
  });
});
