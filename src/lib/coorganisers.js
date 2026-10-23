// Co-organisers (ov35, Josh 23 Oct: "share a trip and ask people to contribute"). The organiser names 1–3 players who
// can change THIS trip's plan like the organiser: the trip builder, calling and closing votes, jobs, money. The
// database enforces it (migration 104: plan_coorganisers, private.is_plan_coorganiser). Pure helpers only.

export const MAX_COORGANISERS = 3;

/**
 * Who I am on this trip.
 * list: plan_coorganisers rows; me: my player id; isAdmin: a group organiser (the REAL status, not a co-organiser's
 * stand-in); plan: the plans row.
 * → { coorg: I'm a named co-organiser, canName: I can add / remove them, organises: I can plan this trip }
 */
export function tripRole({ list = [], me = null, isAdmin = false, plan = null } = {}) {
  const coorg = !!me && (list || []).some((c) => c.player_id === me);
  const tripOrganiser = !!me && !!plan && plan.organiser_id === me;
  const canName = !!isAdmin || tripOrganiser;
  return { coorg, canName, organises: !!isAdmin || coorg };
}

/** Who can be added: players in the group (not guests, not me, not already on), approved. */
export function addable(players = [], list = [], { me = null, guests = [] } = {}) {
  const on = new Set((list || []).map((c) => c.player_id));
  const g = new Set(guests || []);
  return (players || []).filter((p) => p.approved !== false && p.id !== me && !on.has(p.id) && !g.has(p.id));
}

/** "Hamish and Tom can change this plan too." / "" */
export function coorgLine(names = []) {
  const n = (names || []).filter(Boolean);
  if (!n.length) return '';
  const list = n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return `${list} can change this plan too.`;
}

/** The trip's path with the co-organiser's role on it ("Help me plan this"), for push.js appLink. */
export function helpPath(planId) {
  return `/plan/${planId}?view=organise&role=co`;
}

/** The message that goes with it. */
export function helpMessage({ planName = 'the trip', who = null, link = '' } = {}) {
  return `🧰 ${who ? `${who}, help` : 'Help'} me plan ${planName}? You’re a co-organiser — you can change the plan, call the votes and sort the jobs. ${link}`.trim();
}
