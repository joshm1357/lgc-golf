# Moving L.G.C to app.thegolftrip.club (release B only)

**Don't use this until the B move.** It replaces the old app at `joshm1357.github.io/lgc-golf/` with a page that
hands each phone over to `https://app.thegolftrip.club/`.

- `index.html` (and `404.html`, the same page): refreshes the phone's sign-in and passes it across, so players
  keep the same user, group and scores. If the phone has scores that never synced, it stops and says so.
- `sw.js`: replaces the old offline copy so phones stop opening the old app.

How it's published: set `"github_pages_retired": true` in `infra/cloudflare.json` on `main`. `deploy.yml` then
publishes this folder to GitHub Pages instead of the app. See `docs/LAUNCH-HOSTING.md`, step B5.
