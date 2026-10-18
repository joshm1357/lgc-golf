# Setting up Google and email sign-in (Josh)

Decided 18 Oct: Google + emailed link now; no Apple; Facebook later if wanted. **Do everything on staging
(`lgc-golf-staging`) first.** Live only at the v2.0 release STOP. Screens in these dashboards move around, so the menu
names below may be slightly different.

## 1. Supabase staging — basics (5 minutes)
In supabase.com → project **lgc-golf-staging** → Authentication:
1. **Sign In / Providers**
   - Turn on **Allow anonymous sign-ins** (also finishes two Stage 1 tests).
   - Turn on **Allow manual linking** — this lets a phone-only player add Google or email to the *same* account, so
     they keep their scores.
   - **Email** provider: on.
2. **URL Configuration**
   - Site URL: `https://joshm1357.github.io/lgc-golf/`
   - Redirect URLs — add: `https://joshm1357.github.io/lgc-golf/` and `http://localhost:5173/lgc-golf/`

## 2. Google (free, about 15 minutes)
1. console.cloud.google.com → create a project called **The Golf Trip**.
2. APIs & Services → **OAuth consent screen**: External; app name *The Golf Trip*; your email as support and developer
   contact. Save. (Publishing status can stay "Testing" while we test — add your own Google account as a test user.)
3. APIs & Services → **Credentials** → Create credentials → **OAuth client ID** → *Web application*.
   - Authorised redirect URI: `https://ttkaojaqhckiwpgrpxkh.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client secret** into Supabase staging → Authentication → Sign In / Providers →
   **Google** → enable → paste → save.

## 3. Email sending — one thing to decide first
The emailed sign-in link needs a proper email sender (Supabase's built-in one is for testing only). Free services such
as Resend send to *anyone* only once you own and verify a **domain** (e.g. `thegolftrip.club`, which is a Stage 9
purchase). Two ways:
- **A. Wait for the domain** (Stage 9): then set up Resend (free plan) with the domain and paste its SMTP details into
  Supabase → Authentication → Emails → SMTP settings. Until then, Google sign-in only.
- **B. Now, with a Gmail account:** Google account → Security → 2-Step Verification on → **App passwords** → make one
  for "Golf Trip". In Supabase → Authentication → Emails → SMTP: host `smtp.gmail.com`, port `465`, your Gmail
  address as user and sender, the app password. Emails come from that Gmail address; Gmail's daily sending limit is
  far more than a golf group needs. Fine for testing and for L.G.C; switch to A before outside groups.

## 4. Tell me
Message me "Google is set up on staging" (and email, if you did B). I'll then turn the buttons on in the staging build
(`VITE_SIGN_IN=google,email`), test linking a phone-only player to Google and email (same scores, same groups), signing
in on a second phone, and only then ask about live.
