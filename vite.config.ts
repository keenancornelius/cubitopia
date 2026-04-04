import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: './node_modules/.vite',
  // GitHub Pages deploys to https://<user>.github.io/<repo>/
  // Set base dynamically: use '/' for local dev, repo name for production
  base: process.env.GITHUB_ACTIONS ? '/cubitopia/' : '/',
});
