import { defineConfig } from 'vite';
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

// GitHub Pages serves the app from /lgc-golf/
export default defineConfig({
  base: '/lgc-golf/',
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
});
