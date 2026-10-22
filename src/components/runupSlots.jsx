// The run-up's named slots (ov25, 23 Oct 2026) — pieces other builders own, wired in here at the v10 merge.
// The run-up (components/RunUp.jsx) mounts whatever is set; while a slot is null it shows a simple stand-in.
//
//   compsForTrip   ov23's "Comps & on the day", compact: only what's up for grabs (read-only here). The run-up has its
//                  own Rules part; the handicaps check stays on Organise step 6.
//   awardsForTrip  ov24's "Awards & fines for this trip": propose, opinions, rewards (incl. strokes), proof, fines.
//   awardVotes     left empty: AwardsRunUp already lists the proposals waiting for a decision.
import React from 'react';
import { AwardsRunUp } from './AwardsFines.jsx';
import CompsOnTheDay from './CompsOnTheDay.jsx';

const CompsForTrip = ({ pd, trip }) => <CompsOnTheDay pd={pd} trip={trip} isOrg={false} compact />; // just the grabs: the run-up has its own Rules part
const AwardsForTrip = ({ trip }) => <AwardsRunUp trip={trip} title="🏷 Awards & fines" />;

export const RUNUP_SLOTS = {
  compsForTrip: CompsForTrip,
  awardsForTrip: AwardsForTrip,
  awardVotes: null,
};
