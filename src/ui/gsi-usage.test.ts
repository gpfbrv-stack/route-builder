// @vitest-environment jsdom
import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import { GsiUsage, GSI_NOTICE } from './gsi-usage';

it('adds and removes GSI road attribution without duplicating or removing base map attribution', () => {
  const element = document.createElement('div'); document.body.append(element);
  const map = L.map(element), notify = vi.fn();
  map.attributionControl.addAttribution('背景地図');
  const usage = new GsiUsage(map.attributionControl, notify);
  usage.update(false); expect(element.textContent).not.toContain('道路中心線');
  usage.update(true); usage.update(true);
  expect(element.textContent?.match(/道路中心線/g)).toHaveLength(1);
  expect(notify).toHaveBeenCalledExactlyOnceWith(GSI_NOTICE);
  usage.update(false); expect(element.textContent).not.toContain('道路中心線');
  expect(element.textContent).toContain('背景地図');
  usage.update(true); expect(notify).toHaveBeenCalledOnce();
  map.remove(); element.remove();
});
