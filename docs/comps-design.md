# Comps — what you're playing for (design, 21 Oct 2026)

Josh: "The Ryder Cup is a comp type. Comp types should be set up at trip setup or before a round. Choose from different
types of comps, and each comp needs its own setup (adding people to Ambrose groups etc.), with different scoring:
group based, over the weekend or each day, for different cups."

Decisions (Josh, 21 Oct): comps are chosen at trip setup and can be changed later; **a trophy is a comp with a
trophy**; the first version has four families of comp types (below).

## Words
- **Trip:** the weekend. **Round:** one day's golf at a course. A round still has a **format**: how each card is scored
  (Stableford, Ambrose, stroke play, 4BBB).
- **Comp:** what you're playing for. It has a **name**, a **type**, **who plays** (each person, teams, pairs or two
  sides), **which rounds count** (one, some or all of the trip's rounds), optionally a **trophy** (for the honour board)
  and a **to-do list**, i.e. what it needs set up before each round that counts.

## Comp types (first version)
| Family | Type | Who plays | Rounds | How it's won | Needs set up |
|---|---|---|---|---|---|
| Individual | **Points over rounds** (e.g. the BD Trophy) | each person | chosen rounds (Stableford) | most Stableford points | who's playing each counting round, playing handicaps |
| Individual | **Net strokes over rounds** | each person | chosen rounds (stroke play) | lowest net to par | same |
| Individual | **Day winner** | each person | one round | the round's winner (any individual format) | same |
| Teams / pairs | **Ambrose teams** (e.g. Putt Buddies) | teams | chosen rounds (Ambrose) | best net (one round), or total across rounds | teams for each round (new each round or fixed for the trip), team handicaps |
| Teams / pairs | **4BBB pairs** | pairs | chosen rounds (4BBB) | best better-ball points | pairs for each round (fixed or new), round handicaps |
| Cup | **Team match play** (e.g. the 6th Ryder Cup) | two sides for the trip | chosen rounds = sessions | most points; X to win | the two sides, everyone on a side, the matches for each session (singles, Ambrose pairs, 4BBB…) with points |
| Side | **Side comps** | each person | chosen rounds | each hole's winner; plus "most side comp wins" | closest-to-pin / longest-drive holes, own side comps |
| Side | **Games** | each person | chosen rounds | skins, Nassau etc. with a $ tally | the round's games and stakes |

## How it fits what exists (additive only; old app versions keep working)
- New table `comps` (group_id, trip_id, name, kind, round_ids uuid[] (empty = all of the trip's rounds of a matching
  format), settings jsonb, trophy_id → trophies, sort, retired, created_by, created_at). RLS as usual.
- **Trophies stay** (old app versions and the honour board use them). A comp "with a trophy" links to a `trophies` row.
  Each existing trophy gets a matching comp: stableford_total → points over the trip's Stableford rounds;
  ambrose → Ambrose teams over the trip's Ambrose rounds; manual → a manual comp the organiser awards.
- **The Cup** becomes a comp type any group can add. `cup_sides` gets a `comp_id` (one Cup per group for now — the
  existing unique (group_id, sort) can't be dropped). Adding a Cup comp switches the hidden `cup` feature on for the
  group (the database rules on the Cup tables still check it). The "Team match play" switch disappears from the
  feature list.
- Teams, pairs, round players, side comps and games keep their own tables; a comp points at the rounds that count and
  its to-do list links to the right editor.
- All maths in `src/lib/comps.js` (standings per comp type, the to-do list) with tests, reusing board.js, cup.js,
  games.js and sidecomps.js.

## Where people see it
- **Set up your trip:** a new step, "What are you playing for?". Pick from comp cards (plain words plus an example),
  name it, pick the rounds that count, tick "has a trophy". Then each comp shows its to-do list with a button for each
  item ("Friday: make 7 pairs matches", "Sunday: pick Ambrose teams").
- **Comps screen:** every comp of the trip with its standings and to-do list. The Trophy Room shows the comps that
  have a trophy. The leaderboard shows chips for the comps the current round counts towards.
- **Before a round:** the round card lists what its comps still need.

## Later
More than one Cup per group, season comps across trips (the ladder), best N of M rounds, handicap allowances per comp,
and AI setup proposing comps.
