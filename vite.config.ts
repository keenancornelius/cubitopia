import { defineConfig, type Plugin } from 'vite';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * music/manifest.json — { "<folder>": { "<file>.mp3": <bytes>, ... }, "": { root files } }
 * Lets ProceduralMusic load only tracks that exist (no 404 probing, which shows up
 * as console errors) and pick small tracks on low-memory phones.
 */
function musicManifest(): Plugin {
  const musicDir = resolve(__dirname, 'public/music');
  const build = (): string => {
    const out: Record<string, Record<string, number>> = { '': {} };
    if (existsSync(musicDir)) {
      for (const name of readdirSync(musicDir)) {
        const p = join(musicDir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
          out[name] = {};
          for (const f of readdirSync(p)) if (/\.(mp3|ogg|m4a)$/i.test(f)) out[name][f] = statSync(join(p, f)).size;
        } else if (/\.(mp3|ogg|m4a)$/i.test(name)) out[''][name] = st.size;
      }
    }
    return JSON.stringify(out);
  };
  return {
    name: 'cubitopia-music-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0].endsWith('/music/manifest.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(build());
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'music/manifest.json', source: build() });
    },
  };
}

export default defineConfig({
  cacheDir: './node_modules/.vite',
  // Relative base: the same build works at any path prefix —
  // https://<user>.github.io/cubitopia/, https://app.legionajj.com/games/cubitopia/, or /.
  // All runtime fetches (music/...) are relative too.
  base: './',
  plugins: [musicManifest()],
});
