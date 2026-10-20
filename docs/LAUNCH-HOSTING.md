# Launch hosting: the app on thegolftrip.club

Written 20 Oct 2026. Two parts, done in order. **A** gives a test address. **B** moves L.G.C to the real address.
Nothing here touches the live database or the live app until B, and B is a STOP.

| Address | What runs there | Database |
| --- | --- | --- |
| `thegolftrip.club` | The website (repo `thegolftrip-site`) | Cloudflare D1 (register-interest form) |
| `staging.thegolftrip.club` | The `product` branch, for testing | Staging (`lgc-golf-staging`) |
| `app.thegolftrip.club` | The `main` branch, from release B | Live (`lgc-golf`) |
| `joshm1357.github.io/lgc-golf/` | Today: the live L.G.C app. After B: a hand-over page | Live |

## What changed in the code (branch `launch-hosting`)
- The app no longer assumes it lives at `/lgc-golf/`. The build reads `VITE_BASE`. If that's not set, it builds for
  GitHub Pages exactly as before, so nothing changes for L.G.C today.
- The offline copy (`sw.js`) and the home-screen settings (`manifest.webmanifest`) work out their own address.
- **Safety catch:** a build with `VITE_BASE` set but no `VITE_SUPABASE_URL` stops with an error. Without it, a
  forgotten setting would point a test build at the live L.G.C database.
- `public/_headers`: on Cloudflare, phones always check for a newer `sw.js` and page. GitHub Pages ignores this file.
- The `notify` function reads its app link from the `APP_URL` secret. If that's not set, it uses the GitHub Pages address.
- `move-to-app-domain/`: the hand-over page for B (see B5). It's published by `deploy.yml` once `infra/cloudflare.json` says so.

Checked: all 138 tests pass. The GitHub Pages build's page and code files are byte-identical to before
(an independent review confirmed this). A real browser was tested at both `/` and `/lgc-golf/`: no missing files, the offline
copy saved 33 files, and the app opens with no signal. The hand-over was tested with Supabase faked: the new app adopts the
passed-across sign-in as the same user, and the page stops if the phone has unsynced scores.

## Part A: dev and staging addresses (no risk to L.G.C)
How changes flow from now on (dev → staging → production): `docs/RELEASE-FLOW.md`.
Everything runs from GitHub Actions, so Cloudflare settings live in this repo, not in its dashboard:
- `.github/workflows/cloudflare.yml` builds and deploys every branch to the Pages project `thegolftrip-app`. It creates
  the project the first time. It posts the test link on the pull request. `main` only deploys once `infra/cloudflare.json`
  says `"production_deploy": true`.
- `.github/workflows/infra.yml` applies `infra/cloudflare.json` (staging.thegolftrip.club → `product`) whenever that
  file changes on `product`.
- The database settings are in the workflow. A branch other than `main` always builds against staging, and the build
  itself refuses anything else.

**Josh's one-time job** (Chrome prompt `app-hosting-chrome-prompt.md`):
1. Create a Cloudflare API token that can only edit Pages and the DNS of thegolftrip.club. Paste it into GitHub as
   the secret `CLOUDFLARE_API_TOKEN`. That's the only secret; everything else is in `infra/cloudflare.json`.
2. Turn on branch protection for `product` and `main` (pull request + Check ✅).

**Then Claude does the rest:** pushes to pull request #1, which gives it its test link. After Josh's OK, Claude merges it.
staging.thegolftrip.club then sets itself up.

**Later, with Google sign-in** (`docs/SIGN-IN-SETUP.md`), in the same Chrome session:
- Supabase staging → URL configuration: Site URL `https://staging.thegolftrip.club/`. Redirect URLs
  `https://staging.thegolftrip.club/**` and `https://*.thegolftrip-app.pages.dev/**`.
- Then Claude sets `"sign_in": {"staging": "google"}` in `infra/cloudflare.json`. Guest play (PIN and invite links) doesn't need any of this.

**End-to-end test on two phones** at staging.thegolftrip.club: start a group, invite the second phone by link and QR,
score a round, turn on flight mode mid-round and back, Add to Home Screen.

## Part B: L.G.C to app.thegolftrip.club (STOP: Josh's go-ahead)
**Before:** A has passed. Releases v1.5 → v2.2 are on live (their own checklists in `docs/`). No trip is under way.
A day before, ask L.G.C to open the app once with signal, so anything entered offline syncs.

**iPhones (found in review, needs one real test):** an iPhone home-screen app keeps its own storage, apart from Safari.
So after the hand-over and "Add to Home Screen" again, the new icon may start signed out. Nothing is lost, because
scores belong to the *player*, not the phone. The player enters the PIN and picks their name. The app then says
"Someone has already picked that name", and the organiser gives the name back (Players → assign). That's one tap per
iPhone. Two ways to avoid even that:
- (a) Before the move, players link Google or email (Stage 2), then sign in from the new icon.
- (b) Later, a one-time "move code".
Test it on Josh's iPhone at the start of B, using a test player.
1. Cloudflare: in `infra/cloudflare.json`, Claude sets `"production_deploy": true` and moves `_at_release_B_add`
   into `domains` (a pull request, as always). Production deploys, and app.thegolftrip.club points at it.
2. Supabase **live** → URL configuration: Site URL `https://app.thegolftrip.club/`. Add `https://app.thegolftrip.club/**`
   and keep the GitHub address for a month.
3. Google OAuth (live client): add `https://app.thegolftrip.club` as an origin.
4. Live Edge Function secret `APP_URL=https://app.thegolftrip.club/`, then redeploy `notify`.
5. **The move:** Claude sets `"github_pages_retired": true` in `infra/cloudflare.json` (a pull request into `main`).
   On merge, GitHub Pages publishes the hand-over page in place of the app. A later push can't put the old app back,
   because the same setting decides what's published. The hand-over refreshes each phone's sign-in and passes it to the
   new address, so players keep their user, group and scores with no PIN.
6. Website: merge the `open-app-link` branch in `thegolftrip-site`. That adds "Open the app" to the header.
7. Tell L.G.C: "Open the app once from your old icon. It'll move you. Then Add to Home Screen again, and switch
   notifications back on." (Notifications belong to an address, so each phone has to allow them again.)
8. After about a month: remove the GitHub address from Supabase redirects. Make the repo private (this turns off
   GitHub Pages, and the hand-over page with it). Cloudflare keeps building from a private repo.

**Rollback (B):** in Cloudflare, remove the custom domain. Set `"github_pages_retired"` back to `false` and re-run `deploy.yml`, which puts the
app back at the GitHub address. Phones that already moved will need the PIN once.

## Not part of this (still open)
Public launch (C) still needs: Supabase Pro, Turnstile on sign-in, Privacy and Terms with the ABN, and the
coNEXA contract check. Then the website's main button becomes "Start your group".
