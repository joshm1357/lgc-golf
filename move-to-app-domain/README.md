# Moving L.G.C to app.thegolftrip.club (release B only)

**Don't use this until the B move.** It replaces the old app at `joshm1357.github.io/lgc-golf/` with a page that
hands each phone over to `https://app.thegolftrip.club/`.

- `index.html` (and `404.html`, the same page): refreshes the phone's sign-in and passes it across, so players
  keep the same user, group and scores. If the phone has scores that never synced, it stops and says so.
- `sw.js`: replaces the old offline copy so phones stop opening the old app.

How it's published: the workflow `.github/workflows/pages-move.yml` (run by hand) publishes this folder to GitHub
Pages. At the same time, `deploy.yml` must stop publishing the app there. See `docs/LAUNCH-HOSTING.md`, step B5.
