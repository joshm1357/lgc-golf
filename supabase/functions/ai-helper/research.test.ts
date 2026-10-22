// Deno tests for ov17 (22 Oct 2026): Josh's course research in the trip planner — the key facts each course carries,
// the region_guide tool, and the prompt rules (member times, access types, stay-and-play, short replies).
// Fake model, no network, no key.
import nodeAssert from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => nodeAssert.match(s, re);
import { researchFacts, withFacts, researchExtras, pickGuide, placeWord, REGION_TOOL, RESEARCH_RULES, ACCESS_WORDS } from './research.ts';
import { PLAN_TOOLS, CHAT_TOOLS, planSystem, planChatSystem } from './plan.ts';
import { helperRequest, type Deps } from './logic.ts';
import type { AiConfig } from './providers.ts';

// deno-lint-ignore no-explicit-any
type Any = any;

const VINTAGE = {
  library_id: '11111111-0000-4000-8000-000000000001', name: 'The Vintage Golf Club', town: 'Pokolbin', state: 'NSW', region: 'Hunter Valley',
  fee_weekday: 150, fee_weekend: 180, access_type: 'public', good_for_groups: 5, drive_from_sydney_hours: 2.25,
  booking_url: 'https://thevintage.miclub.com.au/x', group_enquiry_url: 'https://thevintagegolfclub.com.au/groups', phone: '02 4998 6789',
  last_checked: '2026-10-01',
  details: {
    style: 'parkland, resort', difficulty: '4 - Greg Norman design, water on 8 holes', rankings: 'GA Top 100 2026: #60; AGD 2026: #60',
    members_times: 'Wed and Sat mornings are member comps until about 11:30am (club site, Oct 2026)',
    visitor_times: 'Public 7 days; Sat after 11:30am',
    access_route: 'Public course - book online; Chateau Elan guests use their booking number',
    stay_and_play: 'Chateau Elan at The Vintage - 2 nights + golf packages (Luxury Escapes, Oct 2026)',
    good_for_groups: '5 - on-site accommodation, public 7 days',
    signature_features: 'Greg Norman design among the vines', on_deal_sites: 'Crazy Golf Deals; Luxury Escapes',
    twilight_or_group_rates: 'Groups of 12+: ask for the group rate (club site, Oct 2026)',
  },
};
const PRIVATE = { ...VINTAGE, library_id: '11111111-0000-4000-8000-000000000002', name: 'Ellerston', access_type: 'member_intro_only', good_for_groups: 1, details: { access_route: 'Members and their guests only' } };
const CLOSED = { ...VINTAGE, library_id: '11111111-0000-4000-8000-000000000003', name: 'Paradise Palms', access_type: 'closed', details: {} };

Deno.test('a course\'s key facts: short, plain, only what we have, source notes trimmed', () => {
  const f: Any = researchFacts(VINTAGE);
  assertEquals(f.access, ACCESS_WORDS.public);
  assertEquals(f.fees, '$150 weekdays, $180 weekends');
  assertEquals(f.members, 'Wed and Sat mornings are member comps until about 11:30am');
  assertEquals(f.good_for_groups, '5/5 — on-site accommodation, public 7 days');
  assertEquals(f.difficulty, 'Greg Norman design, water on 8 holes');
  assertEquals(f.drive_hours_from_sydney, 2.25);
  assertEquals(f.book, VINTAGE.booking_url);
  assertEquals(f.group_enquiry, VINTAGE.group_enquiry_url);
  assertMatch(f.stay_and_play, /^Chateau Elan/);
  assertEquals(f.checked, '2026-10-01');
  assert(JSON.stringify(f).length < 1400, 'compact');
  assertEquals(researchFacts({ library_id: 'x' }), null); // nothing known → nothing sent
  assertEquals((researchFacts(PRIVATE) as Any).access, 'members and their guests only — not for a group');
});

Deno.test('library courses get facts (nearest few only); closed ones are flagged; researched listings added', () => {
  const lib = [{ id: VINTAGE.library_id, name: 'The Vintage' }, { id: CLOSED.library_id, name: 'Paradise Palms' }, { id: 'zz', name: 'Other' }];
  const out: Any[] = withFacts(lib, [VINTAGE, CLOSED]);
  assert(out[0].facts && out[0].facts.access);
  assertEquals(out[1].closed, true);
  assertEquals(out[1].facts, undefined);
  assertEquals(out[2], { id: 'zz', name: 'Other' });
  assertEquals((withFacts(lib, [VINTAGE], 0)[0] as Any).facts, undefined); // max 0 → none
  const extra = researchExtras([VINTAGE, PRIVATE, CLOSED], new Set([VINTAGE.library_id]));
  assertEquals(extra.map((e) => e.name), ['Ellerston']); // already listed and closed ones left out
  assertEquals(extra[0].km, null);
  assertEquals(placeWord('Port Stephens),or(x.eq.1'), 'Port Stephens or x eq 1');
});

const GUIDES = [
  { key: 'access-types', kind: 'general', title: 'How to read access', regions: [], body: '| public | Anyone can book. |' },
  { key: 'member-times', kind: 'general', title: 'Member times', regions: [], body: '**Member times:** Wednesday and Saturday mornings are men\'s comps.' },
  { key: 'booking-platforms', kind: 'general', title: 'Booking platforms', regions: [], body: '- **MiClub**: by far the most common.' },
  { key: 'nsw-hunter', kind: 'region', title: 'NSW: Hunter, Newcastle, Port Stephens, Central Coast', state: 'NSW', regions: ['Hunter Valley', 'Port Stephens'],
    body: '**Hunter Valley (wine country).** The Vintage, Cypress Lakes and Hunter Valley GC are within 10 minutes. ' + 'x'.repeat(900)
      + '\n\n**Port Stephens.** This is the best value for a group: Nelson Bay, Horizons and Pacific Dunes are within 20 minutes. Saturday mornings are member comp time.'
      + '\n\n**Booking and deal sites seen for this area:** MiClub public calendars.' },
  { key: 'tasmania', kind: 'region', title: 'Tasmania', state: 'TAS', regions: ['North-East Tasmania'], body: '**Barnbougle.** The main event.' },
];

Deno.test('region_guide: the right section, the paragraph asked about first, trimmed', () => {
  const g: Any = pickGuide(GUIDES, 'Port Stephens', 600);
  assertEquals(g.key, 'nsw-hunter');
  assertMatch(g.text, /^\*\*Port Stephens\.\*\*/); // the paragraph about the place asked for comes first
  assert(g.text.length <= 600);
  assertMatch(g.text, /Booking and deal sites/); // then the booking notes
  assertMatch(g.more, /Trimmed/);
  assertEquals((pickGuide(GUIDES, 'Hunter Valley') as Any).key, 'nsw-hunter');
  assertEquals((pickGuide(GUIDES, 'Barnbougle') as Any).key, 'tasmania');
  assertEquals((pickGuide(GUIDES, 'how do private clubs work, access?') as Any).key, 'access-types');
  assertEquals((pickGuide(GUIDES, 'member times') as Any).key, 'member-times');
  assertEquals((pickGuide(GUIDES, 'deal sites') as Any).key, 'booking-platforms');
  assertMatch((pickGuide(GUIDES, 'Zzqnowhere') as Any).none, /No region notes/);
  assertMatch((pickGuide([], 'Hunter') as Any).none, /No region notes in the app/);
});

Deno.test('the planner has the region_guide tool, and the prompt rules (ask-first prompt kept)', () => {
  assert(PLAN_TOOLS.some((t) => t.name === 'region_guide'));
  assert(CHAT_TOOLS.some((t) => t.name === 'region_guide'));
  assertEquals(REGION_TOOL.input_schema.required, ['region']);
  for (const sys of [planSystem('2026-10-22', 'L.G.C'), planChatSystem('2026-10-22', 'L.G.C')]) {
    assertMatch(sys, /book after 11:30/);
    assertMatch(sys, /never suggest a "members and their guests only" course for a group/i);
    assertMatch(sys, /stay-and-play only/);
    assertMatch(sys, /Golf ID \/ handicap/);
    assertMatch(sys, /check with the club/);
    assertMatch(sys, /Keep replies short/);
    assertMatch(sys, /Never suggest a closed course/);
  }
  assertMatch(planChatSystem('2026-10-22', 'L.G.C'), /ASK FIRST/); // ov16's ask-first prompt is still there
  assert(planChatSystem('2026-10-22', 'L.G.C').includes(RESEARCH_RULES));
});

// ------------------------------------------------------------------ The tools in a chat turn
const AI: AiConfig = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'test-key-not-real', model: 'example-model-id', caps: { groupPerMonth: 60, personPerDay: 10 } };
function fakeModel(turns: ((req: Any, n: number) => Any)[]) {
  const calls: Any[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    calls.push(req);
    const content = turns[Math.min(calls.length - 1, turns.length - 1)](req, calls.length);
    return new Response(JSON.stringify({ content, stop_reason: content.some((b: Any) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, calls };
}
const use = (id: string, name: string, input: Any = {}) => ({ type: 'tool_use', id, name, input });

Deno.test('a chat turn: courses_near brings each course\'s facts and region_guide its notes to the model', async () => {
  const tools: Any[] = [];
  const model = fakeModel([
    () => [use('t1', 'courses_near', { places: ['Hunter Valley'] }), use('t2', 'region_guide', { region: 'Hunter Valley' })],
    (req) => {
      const seen = JSON.stringify(req.messages.at(-1));
      assertMatch(seen, /member comps until about 11:30am/); // the facts reached the model
      assertMatch(seen, /Chateau Elan/);
      assertMatch(seen, /wine country/); // and the region's notes
      return [use('t3', 'reply_with_draft', {
        message: 'The Vintage is the pick: members have Saturday mornings, so book after 11:30 — stay at Chateau Elan for the easy option.',
        draft: { name: 'March Away', kind: 'trip', dates: [{ start_date: '2027-03-12', end_date: '2027-03-14' }, { start_date: '2027-03-19', end_date: '2027-03-21' }], places: [{ place: 'Hunter Valley', courses: [VINTAGE.library_id] }] },
        questions: [{ text: 'Happy with Saturday after 11:30?', quick: ['Yes', 'Make it Friday'] }],
      })];
    },
  ]);
  const d: Deps = {
    status: { is_member: true, is_admin: true, group_id: 'g1', group_name: 'L.G.C' },
    ai: AI, fetchFn: model.fetchFn, now: () => new Date('2026-10-22T03:00:00Z'), featureOn: async () => true,
    usage: async () => ({ month: 3, today: 1 }), logStart: async () => 1, logEnd: async () => {},
    planContext: async () => ({ courses: [], library: {}, trips: [], today: '2026-10-22', sideComps: true }),
    setupTool: async () => [], history: async () => ({}) as Any,
    applyDb: { insertTrip: async () => 'x', copyLibraryCourse: async () => 'x', insertRound: async () => {} },
    tripPlanContext: async () => ({ today: '2026-10-22', tasksOn: true, library: { [VINTAGE.library_id]: { id: VINTAGE.library_id, name: 'The Vintage Golf Club' } } }),
    // What index.ts's planTool returns, built with the same research.ts functions.
    planTool: async (name, input) => {
      tools.push(name);
      if (name === 'courses_near') return { results: [{ near: input.places[0], courses: withFacts([{ id: VINTAGE.library_id, name: 'The Vintage Golf Club', km: 2 }], [VINTAGE]) }] };
      if (name === 'region_guide') return pickGuide(GUIDES, input.region);
      return [];
    },
    planDb: { insertPlan: async () => 'p', startVotes: async () => {}, insertItems: async () => {}, rsvpIn: async () => {}, post: async () => {} },
    libraryInfo: async () => ({ courses: 400, more: true }),
  };
  const out: Any = await helperRequest({ mode: 'plan_chat', text: 'March, 12 of us, Hunter Valley', messages: [{ role: 'user', text: 'Golf trip' }, { role: 'assistant', text: 'Where?' }] }, d);
  assertEquals(tools, ['courses_near', 'region_guide']); // both in the same turn: one round, not two
  assertMatch(out.chat.message, /book after 11:30/);
  assertEquals(model.calls.length, 2);
  assert(model.calls[0].tools.some((t: Any) => t.name === 'region_guide'));
});
