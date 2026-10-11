// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { pinPopup } from './pins';

it('renders only text, limits descriptions, and passes coordinates without pin metadata', () => {
  const add = vi.fn();
  const popup = pinPopup({ lat: 35, lng: 135, name: '<img src=x onerror=alert(1)>', address: '<b>住所</b>', description: 'あ'.repeat(400), folder: 'レイヤ', googleMapsUrl: 'javascript:alert(1)' }, '旅.kml', add);
  expect(popup.querySelector('img')).toBeNull(); expect(popup.querySelector('b')!.textContent).toContain('<img');
  expect(popup.querySelectorAll('p')[1].textContent).toHaveLength(300);
  expect(popup.textContent).toContain('旅.kml'); expect(popup.textContent).toContain('レイヤ');
  expect(popup.querySelector('a')!.href).toBe('https://www.google.com/maps/search/?api=1&query=35,135');
  popup.querySelector('button')!.click(); expect(add).toHaveBeenCalledExactlyOnceWith({ lat: 35, lng: 135 });
});
it('uses the original Google Maps URL when available', () => {
  const popup = pinPopup({ lat: 35, lng: 135, name: '場所', googleMapsUrl: 'https://www.google.com/maps/place/?q=abc' }, 'Saved Places.json', () => {});
  expect(popup.querySelector('a')!.href).toBe('https://www.google.com/maps/place/?q=abc');
  expect(popup.querySelector('a')!.rel).toContain('noopener');
});
