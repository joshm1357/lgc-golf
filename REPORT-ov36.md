# REPORT — ov36: the trip map's courses
Branch `ov36-course-map` (from `origin/v10-5-caddie-plan-link`), pushed. No migration. Not merged.

## What I built, per item
1. **Every course on the map is pickable.** Cause: the map drew 40 candidates, the list only 12. Now the map and list
   show the same set (all within the drive, after filters); the list pages 12 at a time and says "All N are on the
   map". Any dot's summary card has "+ Put on the table" (organisers), and the list always shows what's on the table,
   even when outside the filters or further out than the drive.
2. **Filters** above the list, applied to the map too: Either / Not played / Played before; ★ minimum (ours, else other
   groups'); type (from course research "style": links, parkland, resort, heathland, sandbelt, coastal, bush,
   country, hills, lakes & water — only types present are offered, the select hides with no data); longest drive;
   sort Suggested / Best rated / Closest / Top ranked (from research "rankings"; options without data hidden).
   Remembered on the trip (`courseFilters`; drive per area in `courseReach`).
3. **Search wider:** "Show N more (N more within 40 min)", then "Search wider: within 40 min of Pokolbin and Cessnock →
   45 min" → 1 h → … → 2 h, each step a bigger library search.
4. **Your own area:** "🔍 Search this part of the map" (bottom of the map) lists the courses in view with the same
   filters; tick to put on the current area's table; "📍 Save as an area: Custom: around Nelson Bay" adds it to the
   areas (box saved in `customAreas`, a 🏠 pin in the middle); its list is the courses in that box.
5. **On the way:** "🚗 On the way up or back" card: courses up to 10/20/30/45 min off the straight-line drive from the
   trip's starting point(s) to where you'd stay (not home rounds within 25 min, not ones already in the list). Tick →
   on the area's table, listed as "On the way up or back · about 12 min off the drive · 55 min from Inner West".
6. Phone (375, no sideways scroll) and laptop checked in screenshots.

## Couldn't do / left out
- "On the way up" and "on the way back" aren't separate yet (straight line is the same both ways) — one card.
- Type data only comes from course_research style text; course_booking_info.features isn't read here.
- A custom area can only be started from an existing area's map (AreaBar, not my file, has no "pick on the map").
- On-the-way courses aren't auto-placed on the way-there / home days (day building is TripBuilder/ov35's code).

## Migration
None. New keys in `trip_builds.state` only: `courseFilters`, `courseReach`, `onWayDetour`, `customAreas`.

## Edits to other builders' files
- `src/screens/TripBuilder.jsx` (ov35): 1) `starts={starts}` on `<AreaStart>`; 2) the region course load uses the
  area's own pins when the region has no towns (a custom area). 6 lines.

## Tests
- Vitest: src/lib/coursemap.test.js 20 new; full run 1,737 pass.
- e2e (port 4365): new course-map-test 47/47; hello-maps 83, plan-ux 84, trip-builder 71, tripfinder 30,
  weekends-comps 75 — all pass. Screenshots: shots-ov36/ (gitignored; copy in the scratchpad shots-ov36/).

## Decisions for Josh
- The drive filter / "Search wider" is separate from the trip's 40-min `stayMax` (which still drives day building).
- Saving a custom area when an area is already chosen reopens the areas list (same as "+ Add another area").
- Filters are one set per trip (not per area); players' filter choices aren't saved.
- "Search this part of the map" refuses more than ~3° × 4° of map ("Zoom in a bit first").
