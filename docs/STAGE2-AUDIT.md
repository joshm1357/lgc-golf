# Stage 2 audit — Proper login, roles and invites

18 Oct 2026. Read-only. **STOP: nothing here switches a sign-in provider on. Josh sets up the accounts below
first; I build the app side on staging meanwhile only where it needs no new sign-in setting.**

## 1. What's there today
- **Sign-in:** anonymous only. Each phone gets an anonymous Supabase user the first time someone types the group PIN.
  Live: 11 sign-ins, all anonymous. A lost or wiped phone means a new anonymous user who has to re-pick their name
  (`claim_player`).
- **Joining:** group PIN → `join_group` / `join_group_id`. Organiser: admin PIN → `claim_admin`.
- **Roles (Stage 1):** `group_members.role` = organiser / player / guest; nothing gives out `guest` yet.
- **Weak spots carried from v1.5:** `claim_player` lets any member link to any player in their group (could pose as
  someone and change their PayID); `claim_admin` has no limit on wrong PIN guesses.

## 2. What Stage 2 builds
1. Sign in with **Apple**, **Google** and an **emailed link**. Guests stay anonymous; a guest who signs in properly
   keeps their scores — the sign-in is **linked** to the same user, not a new one (`linkIdentity` for Apple/Google,
   `updateUser({ email })` for the emailed link).
2. **Roles:** organisers manage the group. The admin PIN stays as a fallback for L.G.C only until every L.G.C player
   has a proper sign-in; new groups have no admin PIN.
3. **Invite link + QR code** per group (organiser can reset it). New groups join by link only; L.G.C's PIN keeps
   working. New table `group_invites` (group_id, token hash, created_by, reset_at), function `join_by_invite(token)`.
4. **Group switcher** in More (uses `my_status().groups` and the group header from Stage 1).
5. Fixes: `claim_player` only for players nobody has claimed (or the organiser hands a player over); a cool-down on
   wrong admin PINs (e.g. 5 tries per hour per sign-in).

## 3. What Josh needs to set up (before any provider is switched on) — STOP
| What | Where | Notes |
|---|---|---|
| **Apple Developer Program** | developer.apple.com | Paid yearly membership (US$99 / about A$149 a year) — needed for Sign in with Apple. Then a Services ID, a Sign in with Apple key (.p8), Team ID and Key ID. **Costs money → your call.** |
| **Google sign-in** | console.cloud.google.com → APIs & Services → Credentials | Free. OAuth consent screen (app name "The Golf Trip", your email) + an OAuth client (Web). |
| **Email sending** | Supabase → Authentication → Emails → SMTP | Supabase's built-in email is for testing only (a handful per hour). A free plan of an email service (e.g. Resend or Postmark) is needed before outside groups use emailed links — **a new account → your call**. |
| **Redirect URLs** | Supabase → Authentication → URL Configuration | Site URL and allowed redirects: `https://joshm1357.github.io/lgc-golf/`, later `https://*.thegolftrip.club/`, and `http://localhost:5173/` for testing. |
| **Provider callback** | in Apple and Google | `https://<project>.supabase.co/auth/v1/callback` (staging first, then live). |
| **Link sign-ins** | Supabase → Authentication → Sign In / Providers | Turn on **manual linking**, so a guest can add Apple/Google to the same user. |
| **Anonymous sign-ins on staging** | `lgc-golf-staging` → Authentication → Sign In / Providers | Needed now to finish the Stage 1 tests (live already has it on). |

Each setting is done on **staging first**; live only at the v2.0 release STOP.

## 4. Order
Stage 2 app work that needs none of the above (invite links, QR, group switcher, roles, the two fixes) can be built on
staging now. The sign-in buttons are built but stay hidden until the providers are set up and tested on staging.
