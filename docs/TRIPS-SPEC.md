# Stage 1b — Trips (and when you hear about them)

Decided with Josh, 18 Oct 2026. Built straight after Stage 1, on staging, before Stage 2.

## The idea in one line
One **Trip** that moves through stages — from a rough idea, through votes on dates and place, to the weekend itself,
to the record afterwards — instead of today's split between a plan in "Coming up" and a trip behind the leaderboard.

## What's per trip and what's group-wide
| Per trip | Group-wide (the same on every trip) |
|---|---|
| Dates and place votes, discussion, who's in, details, day plan, jobs, bring list, costs, rooms and cars, rounds, scores, side comps, feed posts, photos, results | Rulebook, players and handicaps, the Tribunal, courses, trophies and honour boards |

A trip **uses** the rules in force; trophy wins are recorded against the trip they were won on.

## The trip journey
| Stage | What happens | Who moves it on |
|---|---|---|
| **1. Idea** | Anyone suggests a trip: name, rough timing (a month or 2–3 date options), 1–3 places, rough budget per head, a note. The app opens a **dates vote** and a **place vote** straight away from what was suggested; anyone can add options. | Automatic |
| **2. Deciding** | Votes run to a close date (reminder the day before, as now). A **discussion** thread on the trip for the back-and-forth. Leading options show live. | The **admin** picks each winner — or the trip's organiser too, if the group allows it (see below) |
| **3. Locked in** | Dates and place filled in from the winners. Who's in, details, jobs, bring list, costs, rooms and cars — today's tabs. | Admin locks the list when ready |
| **4. On the trip** | Rounds, live scoring, comps, feed, the draw — the same trip, no "convert to trip" step. | Starts on the first day automatically |
| **5. Done** | Results, trophy winners, photos and settled costs stay with the trip as its record. | Admin marks it done (or it closes a week after the last day) |
| *Called off* | Kept in the list, greyed out. | Admin |

**Group setting — "Who decides votes":** *The admin* (default) or *The admin or the trip's organiser*. Each trip has an
organiser (whoever suggested it, changeable by the admin).

## The Trips tab (replaces "Coming up" in the bottom bar)
1. **Now and next** — the trip that's on, or the next locked-in trip, big at the top with its countdown.
2. **Ideas and voting** — each card shows its stage and what's still to decide ("Dates: 2 options, closes Fri").
3. **Past trips** — newest first: dates, place, winners, a photo. The 2026 South Coast trip goes here, and Stage 6
   history import adds older ones.

One-day rounds are a kind of trip (same journey, shorter).

## How it fits the database (additive — old phones keep working)
- A trip's planning side stays in `plans` and its playing side in `trips` (rounds, trophies hang off it). A plan
  gets its `trips` row created automatically when it's locked in, so the app shows them as one; past trips with no
  plan (2026 South Coast) get a plan row added so everything sits in one list.
- New: `plans.organiser_id`; `plan_comments` (discussion); `groups.vote_decider` ('admin' | 'admin_or_organiser');
  a rule letting the person who suggested a trip open its first dates/place votes.
- The leaderboard keeps working exactly as now during a trip.

## When you hear about things (notifications)
**Phones:** Android (Chrome) — works in the browser. iPhone — only once the app is added to the Home Screen and opened
from there (iOS 16.4+, Apple's rule); the app shows iPhone users how, the first time. Later (Stage 2, once people have an
email address): an **email digest** for anyone who never adds it.

**Each person picks, per group** (More → Notifications):
| Setting | What happens |
|---|---|
| **Straight away** | Each thing as it happens (today's behaviour) |
| **Daily digest at [time]** | One message a day at the time you pick: "2 votes open · 1 job due · Mike says he paid you $40" |
| **Only important** | Just: draw room open, a job given to you, money owed to you, your trip tomorrow |

"The draw room is open" always comes straight away. Behind the scenes: messages for digest people wait in a queue
(`notify_queue`); an hourly job sends each person's digest at their hour; settings in `notify_prefs`
(group, person, setting, digest hour). Default for everyone: **Straight away** (no change for L.G.C).

## Tests
- A suggestion opens its two votes; the suggester can add options; non-members can't see any of it (isolation test
  extended to `plan_comments`, `notify_prefs`, `notify_queue`).
- With "admin only", the organiser can't pick a winner; with "admin or organiser", they can — on their own trip only.
- Lock-in creates the trip once (not twice on a retry); scoring on it works as today.
- Digest: three events for a digest person → one message at their hour, none straight away; "draw room open" still
  instant; an "only important" person gets nothing for a new vote.
- Phone-width check of the Trips tab: now/next, ideas, past; a suggestion from start to locked in.

## Status (18 Oct)
Built and tested on staging (branch `stage-1b-trips`, migrations 025–026). Not yet: winners on past-trip cards (needs
the honour board linked to trips — Stage 6), an email digest (Stage 2, once people have an email address).
