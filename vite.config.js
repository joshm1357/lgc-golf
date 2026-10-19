import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The app is split into parts that load when a screen is first opened. This writes a list of every
// part (asset-list.json) so the service worker can save them all for offline use, not just the
// parts the first page needs.
function assetList() {
  return {
    name: 'lgc-asset-list',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).sort();
      this.emitFile({ type: 'asset', fileName: 'asset-list.json', source: JSON.stringify(files) });
    },
  };
}

// Where the app lives. GitHub Pages serves it from /lgc-golf/ (the default, so that build is unchanged).
// Cloudflare (app.thegolftrip.club, staging.thegolftrip.club) sets VITE_BASE=/ in its build settings.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE || '/lgc-golf/';
  // Safety catch: a build for any other address must say which database it uses. Without this, a
  // forgotten setting would quietly point a test build at the live L.G.C database.
  if (command === 'build' && env.VITE_BASE && !env.VITE_SUPABASE_URL) {
    throw new Error('VITE_BASE is set but VITE_SUPABASE_URL is not. Set both in the host\'s build settings.');
  }
  return {
    base,
    plugins: [react(), assetList()],
    build: {
      rollupOptions: {
        output: {
          // Only the starting file is called index-….js (the "New version ready" check looks for it).
          chunkFileNames: 'assets/part-[name]-[hash].js',
        },
      },
    },
    test: { environment: 'node' },
  };
});
