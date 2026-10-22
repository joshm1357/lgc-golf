// The run-up's named slots (ov25, 23 Oct 2026) — pieces other builders own, wired in here at merge.
// The run-up (components/RunUp.jsx) mounts whatever is set; while a slot is null it shows a simple stand-in.
//
//   compsForTrip   ov23's "Comps & on the day" piece for one trip: what's up for grabs, rules, handicaps, teams.
//                  Rendered as <CompsForTrip pd={pd} trip={trip} compact />.
//   awardsForTrip  ov24's "Awards & fines for this trip": propose, opinions, rewards (incl. strokes), proof, fines.
//                  Rendered as <AwardsForTrip pd={pd} trip={trip} compact />.
//   awardVotes     ov24's open award / fine proposals to vote on inline, for "Up for a vote".
//                  Rendered as <AwardVotes pd={pd} trip={trip} />.
//
// To wire one: import it here and set it, e.g.
//   import { CompsAndOnTheDay } from './CompsAndOnTheDay.jsx';
//   export const RUNUP_SLOTS = { compsForTrip: CompsAndOnTheDay, ... };
export const RUNUP_SLOTS = {
  compsForTrip: null,
  awardsForTrip: null,
  awardVotes: null,
};
