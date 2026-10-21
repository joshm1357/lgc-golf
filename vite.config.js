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

const LIVE_DB = 'luogyzvrbedmicjejilr'; // the live L.G.C database (Supabase project ref)

// Dev and staging builds (any database that isn't live) get a small red "TEST" tag on screen and are hidden
// from search engines. That way a test version is never mistaken for the real app. The live build is left untouched.
function testMarker(env) {
  const db = env.VITE_SUPABASE_URL || '';
  const isTest = db && !db.includes(LIVE_DB);
  const branch = env.CF_PAGES_BRANCH || '';
  const commit = (env.CF_PAGES_COMMIT_SHA || '').slice(0, 7);
  const label = ['TEST · staging data', branch, commit].filter(Boolean).join(' · ').replace(/[<>&"]/g, '');
  return {
    name: 'lgc-test-marker',
    transformIndexHtml(html) {
      if (!isTest) return html;
      return html
        .replace('</head>', '    <meta name="robots" content="noindex, nofollow" />\n  </head>')
        .replace('</body>', `  <div id="test-marker" style="position:fixed;top:env(safe-area-inset-top,0);left:50%;transform:translateX(-50%);z-index:99999;pointer-events:none;background:#B3261E;color:#fff;font:600 11px/1 system-ui,sans-serif;letter-spacing:.04em;padding:4px 10px;border-radius:0 0 8px 8px;opacity:.9;white-space:nowrap">${label}</div>\n  </body>`);
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
  // On Cloudflare: only the main branch (production) may use the live database, and it must.
  // So a dev or staging version can never read or write L.G.C's real data, whatever the settings say.
  const cfBranch = env.CF_PAGES_BRANCH;
  if (command === 'build' && cfBranch) {
    const usesLive = (env.VITE_SUPABASE_URL || '').includes(LIVE_DB);
    if (cfBranch !== 'main' && usesLive) throw new Error(`Branch "${cfBranch}" is set to the LIVE database. Only main may use it; check Cloudflare's Preview variables.`);
    if (cfBranch === 'main' && !usesLive) throw new Error('main (production) is not set to the live database; check Cloudflare\'s Production variables.');
  }
  return {
    base,
    plugins: [react(), assetList(), testMarker(env)],
    build: {
      rollupOptions: {
        output: {
          // Only the starting file is called index-….js (the "New version ready" check looks for it).
          chunkFileNames: 'assets/part-[name]-[hash].js',
        },
      },
    },
    // Edge functions' own tests (*.test.ts under supabase/functions) are Deno tests: run them with `deno test`.
    test: { environment: 'node', exclude: ['**/node_modules/**', 'supabase/functions/**'] },
  };
});
