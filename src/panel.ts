export function installPanel(panel: HTMLElement, handle: HTMLButtonElement) {
  const mobile = matchMedia('(max-width: 767px)');
  let height = 112, startY = 0, startHeight = 0, dragged = false;
  const limits = () => ({ min: 112, max: Math.max(160, (panel.parentElement?.clientHeight ?? 600) * 0.85) });
  const apply = (next: number) => {
    const { min, max } = limits(); height = Math.min(max, Math.max(min, next));
    panel.parentElement!.style.setProperty('--panel-height', `${height}px`);
    handle.setAttribute('aria-expanded', String(height > min + 20));
    handle.setAttribute('aria-label', height > min + 20 ? 'ルート情報を閉じる' : 'ルート情報を開く');
  };
  handle.onpointerdown = event => {
    if (!mobile.matches) return;
    startY = event.clientY; startHeight = height; dragged = false; handle.setPointerCapture(event.pointerId);
  };
  handle.onpointermove = event => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const delta = startY - event.clientY; if (Math.abs(delta) > 6) dragged = true;
    if (dragged) apply(startHeight + delta);
  };
  handle.onpointerup = event => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); };
  handle.onclick = () => { if (dragged) { dragged = false; return; } apply(height > limits().min + 20 ? limits().min : limits().max); };
  handle.onkeydown = event => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); apply(height + (event.key === 'ArrowUp' ? 64 : -64)); }
  };
  window.addEventListener('resize', () => apply(height)); apply(height);
}
