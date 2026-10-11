/** A separate live region keeps action feedback visible above background status. */
export function installToast(parent: HTMLElement = document.body) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  parent.append(element);
  const editBar = document.querySelector<HTMLElement>('.edit-bar');
  if (editBar) new ResizeObserver(() => {
    element.style.setProperty('--edit-bar-h', `${editBar.getBoundingClientRect().height}px`);
  }).observe(editBar);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (message: string) => {
    clearTimeout(timer);
    // Native dialogs occupy the top layer, above the rest of the document.
    (document.querySelector('dialog[open]') ?? parent).append(element);
    element.replaceChildren(document.createTextNode(message));
    timer = setTimeout(() => element.replaceChildren(), 3000);
  };
}
