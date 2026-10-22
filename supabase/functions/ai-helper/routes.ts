// ai-helper — "Take me there" (the Caddie, 22 Oct 2026): the fixed list of places in the app the AI can point to,
// and the check on what it asks for. The app has the same list in src/lib/caddie.js (with the words people use
// and how to build each link); src/lib/caddie.test.js checks the two match.
//
// The go_to tool is read-only: it never changes anything. It hands back a destination key and ids; the app shows
// a "Go there →" button and only moves when the person taps it. Rules:
//   * the key must be one of DESTINATIONS (anything else is refused);
//   * ids must be the group's own rounds / trips / plans — looked up with the person's own sign-in (index.ts), so
//     another group's id is never found;
//   * organiser-only places are only offered to organisers (and refused for players);
//   * a place behind a switched-off feature is refused.
// No Deno or network imports here, so the app's Vitest can read this file too.

// deno-lint-ignore no-explicit-any
type Any = any;
type Kind = 'round' | 'trip' | 'plan';
export type Destination = { key: string; label: string; needs: Kind[]; takes: Kind[]; organiser: boolean; feature: string | null };

const D = (key: string, label: string, o: Partial<Destination> = {}): Destination =>
  ({ key, label, needs: [], takes: [], organiser: false, feature: null, ...o });

export const DESTINATIONS: Destination[] = [
  D('leaderboard', 'Leaderboard', { takes: ['round'] }),
  D('score', 'Enter scores', { needs: ['round'] }),
  D('comps_board', 'What we’re playing for'),
  D('cup', 'The Cup', { feature: 'cup' }),
  D('rulebook', 'The Rulebook'),
  D('propose_rule', 'Propose a rule'),
  D('games', 'Games & side bets', { takes: ['round'], feature: 'games' }),
  D('admin_round', 'Round setup', { needs: ['round'], organiser: true }),
  D('admin_teams', 'Teams & pairs', { needs: ['round'], organiser: true }),
  D('admin_players', 'Players & handicaps', { organiser: true }),
  D('setup_trip', 'Set up your trip', { takes: ['trip'], organiser: true }),
  D('trips', 'Trips', { feature: 'planner' }),
  D('trip_overview', 'Trip overview', { needs: ['plan'], feature: 'planner' }),
  D('trip_organise', 'Organise the trip', { needs: ['plan'], feature: 'planner' }),
  D('history_import', 'Bring in our history', { organiser: true, feature: 'ai_helper' }),
  D('notifications', 'Notifications', { feature: 'notifications' }),
  D('profile', 'My profile'),
  D('group', 'Group & invites'),
  D('stats', 'Stats & season ladder', { feature: 'stats' }),
  D('trophies', 'The Trophy Room', { feature: 'trophies' }),
  D('replay', 'Round replay', { needs: ['round'], feature: 'replay' }),
  D('feed', 'The Feed', { feature: 'feed' }),
];
/** The Organise tabs of a trip (screens/Planner.jsx TABS). */
export const ORGANISE_TABS = ['vote', 'chat', 'people', 'details', 'jobs', 'kitty', 'groups'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (s: unknown) => typeof s === 'string' && UUID.test(s);

/** The places this person may be offered (organiser-only ones only for organisers). */
export function destinationsFor(isAdmin: boolean): Destination[] {
  return DESTINATIONS.filter((d) => isAdmin || !d.organiser);
}

/** The go_to tool, with only the places this person may be offered. */
export function goToTool(isAdmin: boolean) {
  const list = destinationsFor(isAdmin);
  return {
    name: 'go_to',
    description: 'Offer to take the person to a screen in the app (they get a "Go there" button and tap it themselves). Use it when they want to go somewhere or do something: you can\'t change anything yourself, so point them to the screen where they can. '
      + `Places: ${list.map((d) => `${d.key} (${d.label}${d.needs.length ? `; needs a ${d.needs.join(', ')}` : ''})`).join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', enum: list.map((d) => d.key) },
        round: { type: 'string', description: 'A round id (or part of its name). Blank = the round on their screen, else the live or next one.' },
        trip: { type: 'string', description: 'A trip id (or part of its name). Blank = the current trip.' },
        plan: { type: 'string', description: 'A trip plan id. Blank = the trip on their screen, else the current one.' },
        tab: { type: 'string', enum: ORGANISE_TABS, description: 'Only for trip_organise: which tab.' },
      },
      required: ['destination'],
      additionalProperties: false,
    },
  };
}

export type Known = {
  rounds: { id: string; name?: string | null; play_date?: string | null; status?: string | null; course_name?: string | null }[];
  trips: { id: string; name?: string | null }[];
  plans: { id: string; name?: string | null }[];
};
export type GoTo = { key: string; label: string; round?: string; trip?: string; plan?: string; tab?: string };

function pick(list: { id: string; name?: string | null; course_name?: string | null }[], raw: unknown): { id?: string; bad?: boolean } {
  if (raw == null || raw === '') return {};
  const s = String(raw).trim().toLowerCase().slice(0, 80);
  if (!s) return {};
  if (isId(s)) {
    const hit = list.find((x) => x.id.toLowerCase() === s);
    return hit ? { id: hit.id } : { bad: true };
  }
  const hit = list.find((x) => String(x.name || '').toLowerCase() === s)
    || list.find((x) => String(x.name || '').toLowerCase().includes(s) || String(x.course_name || '').toLowerCase().includes(s));
  return hit ? { id: hit.id } : { bad: true };
}

/**
 * Check what the model asked for. `known` is the group's own rounds, trips and plans (read with the person's own
 * sign-in); `defaults` are the ones on their screen (or live / current), used when the model leaves an id blank.
 * `featureOn` says which features are on. Returns the destination, or the reason it's refused (for the model).
 */
export function checkGoTo(input: Any, o: { isAdmin: boolean; known: Known; defaults?: Partial<Record<Kind, string | null>>; featureOn?: (k: string) => boolean }):
  { ok: true; go: GoTo } | { ok: false; error: string } {
  const key = String(input?.destination ?? '').trim();
  const d = DESTINATIONS.find((x) => x.key === key);
  if (!d) return { ok: false, error: 'That isn’t one of the places in the app. Use one from the list.' };
  if (d.organiser && !o.isAdmin) return { ok: false, error: 'That screen is for organisers only — tell them to ask their organiser.' };
  if (d.feature && o.featureOn && !o.featureOn(d.feature)) return { ok: false, error: `${d.label} is switched off for this group.` };
  const go: GoTo = { key: d.key, label: d.label };
  const lists: Record<Kind, Known['rounds']> = { round: o.known.rounds, trip: o.known.trips, plan: o.known.plans };
  for (const kind of [...d.needs, ...d.takes] as Kind[]) {
    const got = pick(lists[kind], input?.[kind]);
    if (got.bad) return { ok: false, error: `No ${kind} like that in this group.` };
    let id = got.id;
    if (!id) {
      const def = o.defaults?.[kind];
      if (def && lists[kind].some((x) => x.id === def)) id = def;
    }
    if (!id && d.needs.includes(kind)) return { ok: false, error: `Which ${kind}? There isn’t one to point to.` };
    if (id) go[kind] = id;
  }
  if (d.key === 'trip_organise' && input?.tab != null && input.tab !== '') {
    if (!ORGANISE_TABS.includes(String(input.tab))) return { ok: false, error: 'No tab by that name.' };
    go.tab = String(input.tab);
  }
  return { ok: true, go };
}

// ------------------------------------------------------------------ The screen they're on (sent by the app as data)

const SCREEN = /^[a-z_]{1,30}$/;
const WORD = /^[a-z_]{1,20}$/;
/** The app's `context`, cleaned: only these fields, ids must be ids, short words only. Anything else is dropped. */
export function cleanContext(raw: unknown): { screen: string; round_id?: string; trip_id?: string; plan_id?: string; view?: string; tab?: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const screen = String(r.screen ?? '');
  if (!SCREEN.test(screen)) return null;
  const out: Any = { screen };
  for (const k of ['round_id', 'trip_id', 'plan_id']) if (isId(r[k])) out[k] = String(r[k]).toLowerCase();
  for (const k of ['view', 'tab']) if (typeof r[k] === 'string' && WORD.test(r[k] as string)) out[k] = r[k];
  return out;
}
