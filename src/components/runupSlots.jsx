// The run-up's named slots (ov25, 23 Oct 2026) — pieces other builders own, wired in here at the v10 merge.
// The run-up (components/RunUp.jsx) mounts whatever is set; while a slot is null it shows a simple stand-in.
//
//   compsForTrip   ov23's "Comps & on the day", compact: only what's up for grabs (ov32: organisers tick cups here). The run-up has its
//                  own Rules part; the handicaps check stays on Organise step 6.
//   awardsForTrip  ov24's "Awards & fines for this trip": propose, opinions, rewards (incl. strokes), proof, fines.
//   awardVotes     left empty: AwardsRunUp already lists the proposals waiting for a decision.
import React from 'react';
import { useSession } from '../lib/store.jsx';
import { AwardsRunUp } from './AwardsFines.jsx';
import CompsOnTheDay from './CompsOnTheDay.jsx';

// ov32: organisers tick the group's cups on here (Josh: "The selection of the cups up for grabs should be in the
// run-up"); players see the same list read-only.
function CompsForTrip({ pd, trip }) {
  const { status } = useSession();
  return <CompsOnTheDay pd={pd} trip={trip} isOrg={!!status?.is_admin && !status?.viewing} compact />; // just the grabs: the run-up has its own Rules part
}
const AwardsForTrip = ({ trip }) => <AwardsRunUp trip={trip} title="🏷 Fines & awards" />;

export const RUNUP_SLOTS = {
  compsForTrip: CompsForTrip,
  awardsForTrip: AwardsForTrip,
  awardVotes: null,
};
