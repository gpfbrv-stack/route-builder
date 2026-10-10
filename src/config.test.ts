import { expect, it } from 'vitest';
import { BASE_LAYERS } from './config';
it('offers five attributed basemaps using only approved tile hosts', () => {
  expect(BASE_LAYERS).toHaveLength(5);
  for (const layer of BASE_LAYERS) {
    expect(['cyberjapandata.gsi.go.jp', 'tile.openstreetmap.org']).toContain(new URL(layer.url).hostname);
    expect(layer.attribution).toMatch(/地理院タイル|OpenStreetMap contributors/);
  }
});
