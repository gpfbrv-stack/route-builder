// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installToast } from './toast';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
it('announces, replaces and clears feedback three seconds after the latest message', () => {
  vi.useFakeTimers();
  const toast = installToast();
  const element = document.querySelector('.toast')!;
  expect(element.getAttribute('role')).toBe('status');
  expect(element.getAttribute('aria-live')).toBe('polite');
  expect(element.textContent).toBe('');
  toast('保存しました');
  expect(element.textContent).toBe('保存しました');
  vi.advanceTimersByTime(2000);
  toast('共有しました');
  expect(document.querySelectorAll('.toast')).toHaveLength(1);
  expect(element.textContent).toBe('共有しました');
  vi.advanceTimersByTime(2999);
  expect(element.textContent).toBe('共有しました');
  vi.advanceTimersByTime(1);
  expect(element.textContent).toBe('');
});
it('renders literal text inside an open dialog so feedback is visible in the top layer', () => {
  const toast = installToast();
  const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
  toast('<b>保存しました</b>');
  expect(dialog.querySelector('.toast')!.textContent).toBe('<b>保存しました</b>');
  expect(dialog.querySelector('b')).toBeNull();
  dialog.open = false;
  toast('次の通知');
  expect(document.body.querySelector(':scope > .toast')!.textContent).toBe('次の通知');
});
