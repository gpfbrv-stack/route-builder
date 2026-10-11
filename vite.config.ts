import { defineConfig } from 'vite';

// GitHub Pages serves the site under /route-builder/; local dev and preview stay at /.
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/route-builder/' : '/',
});
