export function installPanel(panel: HTMLElement, handle: HTMLButtonElement) {
  const mobile = matchMedia('(max-width: 767px)');
  const snaps = () => [168, Math.round(innerHeight * .5), Math.round(innerHeight * .88)];
  let snap = 0, height = 168, startY = 0, startHeight = 0, dragging = false, moved = false;
  const apply = (h: number) => { height = h; document.documentElement.style.setProperty('--sheet-h', `${h}px`); };
  const toSnap = (i: number) => { snap = i; apply(snaps()[i]); handle.setAttribute('aria-expanded', String(i > 0)); handle.setAttribute('aria-label', `ルート情報（${['最小', '半分', '全体'][i]}）。押すと次の高さ`); };
  handle.onpointerdown = e => { if (!mobile.matches) return; startY = e.clientY; startHeight = height; dragging = true; moved = false; handle.setPointerCapture(e.pointerId); document.documentElement.classList.add('sheet-dragging'); };
  handle.onpointermove = e => { if (!dragging) return; const delta = startY - e.clientY; moved ||= Math.abs(delta) > 6; if (moved) apply(Math.max(168, Math.min(snaps()[2], startHeight + delta))); };
  const end = (e: PointerEvent) => {
    if (!dragging) return; dragging = false; document.documentElement.classList.remove('sheet-dragging');
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    const s = snaps(); toSnap(s.reduce((best, h, i) => Math.abs(h - height) < Math.abs(s[best] - height) ? i : best, 0));
  };
  handle.onpointerup = end; handle.onpointercancel = end;
  handle.onclick = () => { if (moved) { moved = false; return; } toSnap((snap + 1) % 3); };
  handle.onkeydown = e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); toSnap(Math.max(0, Math.min(2, snap + (e.key === 'ArrowUp' ? 1 : -1)))); } };
  window.addEventListener('resize', () => toSnap(snap)); toSnap(0);
  return { expand: () => toSnap(2), panel };
}
