# How a change gets from idea to live

Written 20 Oct 2026. Three steps, each with its own web address. Nothing reaches L.G.C until Josh says so.

| Step | Branch | Web address | Database | Who moves it on |
| --- | --- | --- | --- | --- |
| **Dev** | any branch with a pull request | `<branch>.thegolftrip-app.pages.dev` | staging | Josh merges the pull request |
| **Staging** | `product` | `staging.thegolftrip.club` | staging | Josh says "go vX.Y" |
| **Production** | `main` | `app.thegolftrip.club` (until release B: `joshm1357.github.io/lgc-golf/`) | **live** | — |

## The loop
1. **Build on a branch.** Claude (or Josh) works on a new branch, never straight on `product` or `main`, and opens a
   pull request into `product`.
2. **Two things happen by themselves:**
   - **Check** (GitHub Actions) runs the tests and both builds. It shows ✅ or ❌ on the pull request.
   - **Cloudflare** builds that branch and posts a link on the pull request, e.g.
     `https://launch-hosting.thegolftrip-app.pages.dev`. Every new push updates the same link.
3. **Josh tests the link on his phone.** A red **TEST** tag across the top shows the branch and version, so it's never
   mistaken for the real app. It uses staging data, so nothing he does there touches L.G.C.
4. **Merge** when it's right. GitHub won't allow it until Check is ✅. `staging.thegolftrip.club` updates in about a
   minute: that's the next version, all together.
5. **Release** (a STOP; Josh says "go vX.Y"): see "A release, step by step" below.

## A release, step by step
1. **Snapshot first.** Claude takes a read-only copy of the live data into the Caddie folder (`backups/`, never synced
   to GitHub). Until Supabase Pro (which keeps daily backups), this is the only copy, so it is never skipped.
2. **Database changes on live**, in order, from that version's release checklist (`docs/RELEASE-vX.Y.md`). They're
   additive only, so the app version phones are running keeps working throughout.
3. **Pull request `product` → `main`.** Check ✅, merge. Production builds itself (GitHub Pages until release B, then
   app.thegolftrip.club).
4. **Tag it:** `vX.Y` on `main`, so we can always get back to exactly this version.
5. **Smoke test on your phone, on production:** open the app, see the leaderboard, enter and delete a test score in a
   practice round, open the Feed.
6. Write it up: one dated line in the Caddie folder's `decisions.md`, plus BUILD-STATUS.

**If something's wrong after a release:**
- **App:** roll back first, then fix. On Cloudflare: thegolftrip-app → Deployments → the previous production one →
  "Rollback". It's instant. On GitHub Pages (until B): Actions → the last good deploy → "Re-run".
- **Database:** changes are additive, so the previous app version keeps working against them. Nothing needs undoing
  to roll the app back. If data itself is damaged, restore from the step-1 snapshot (Claude does this, with Josh in the chat).

## Built-in safety catches
- A dev or staging build **cannot** use the live database. The build stops with an error if Cloudflare's settings point a
  branch other than `main` at live.
- A production build **cannot** use the staging database (the same check the other way round).
- Dev and staging are hidden from search engines and carry the TEST tag. Production has neither.
- `product` and `main` only change through a pull request with a ✅ Check (GitHub branch protection).

## Kept up to date automatically
- **Libraries:** every Monday, Dependabot opens a pull request with small updates grouped together. Big version
  jumps come one at a time. Each gets a test link and a Check like any other change. Merge the green ones after a quick look.
- **Node version:** one file, `.node-version` (22). GitHub, Cloudflare and laptops all read it.

## Good to know
- **All dev links share the one staging database.** Two branches tested at once see each other's test groups. That's
  fine at our size. Separate databases per branch need Supabase Pro plus branching (extra cost), so that waits until
  it's worth it.
- **Database changes** in a branch are applied to staging by hand (`supabase/migrations/`, numbered) before testing its
  link. Live gets them only at release.
- **Signing in on a dev link** (Google, email) works because staging's sign-in settings allow any
  `*.thegolftrip-app.pages.dev` address.
- **Old branches** (`stage-1-groups` and so on) only build if someone pushes to them again.
- **The website** (`thegolftrip-site`) works the same way: a branch gets `<branch>.thegolftrip-site.pages.dev`.
  For example, `open-app-link` can be checked before it's merged.
