# v2.2 release — checklist (STOP: nothing here runs until Josh says go)

v2.2 = Stage 10 (booking links, group booking enquiries) and Stage 11 (premium-ready; everything stays free). Built and
tested on **staging** only. It sits on v2.1 (`docs/RELEASE-v2.1.md`), which must go first.

## The release (after your OK, after v2.1)
1. Live database, SQL editor on `lgc-golf` (live): `042` → `043` → `044`. All additive.
2. Merge `product` into `main`.
3. Check: a trip's Details with **Booking links** switched on (More → Group & invites → Features), a partner course
   page's "Ask about a group booking" (needs a claimed course with a bookings email — so after your first real club).

## Decisions that are yours
- Booking links go to Booking.com and Google Maps with no referral codes. Adding a referral code later is one line in
  the `booking_targets` table; the app then says so on screen automatically.
- Group booking enquiries: no money changes hands. Any future payment goes to the club itself, never to staff, and is
  disclosed.
- Nothing is premium yet. The ideas list is in `DEV-PLAN.md`.
