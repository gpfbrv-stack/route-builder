export function installPopover(button: HTMLButtonElement, pop: HTMLElement) {
  const close = (restore = false) => { pop.classList.remove('open'); button.setAttribute('aria-expanded', 'false'); if (restore) button.focus(); };
  button.onclick = () => { const open = pop.classList.toggle('open'); button.setAttribute('aria-expanded', String(open)); if (open) pop.querySelector<HTMLElement>('button, input')?.focus(); };
  document.addEventListener('pointerdown', e => { if (!pop.contains(e.target as Node) && !button.contains(e.target as Node)) close(); });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } });
  document.addEventListener('focusin', e => { if (!pop.contains(e.target as Node) && !button.contains(e.target as Node)) close(); });
  return close;
}
