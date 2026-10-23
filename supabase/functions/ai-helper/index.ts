// ai-helper — the AI helper inside the app (21 Oct 2026; v2 the same night). Its jobs:
//   * "Set it up for me" (organisers): plain words → a setup plan (trip, courses, rounds, side comps). Nothing is
//     saved until the organiser taps "Do it", which calls this function again with { mode: 'apply', plan }.
//   * "✨ Plan it with AI" (organisers, Trips tab): plain words → a trip plan to vote on (dates, places, jobs, bring
//     list, rough costs). Nothing is saved until [Create it] → { mode: 'plan_apply', plan }.
//   * Ask (anyone in the group): what's on (current trip, live round, who's leading, what someone needs) and the
//     group's history (trips, rounds, honour boards, records, handicaps). The Caddie (22 Oct) asks the same way, with
//     the screen it's on (`context`, cleaned in routes.ts and passed as data) and a read-only go_to tool that offers a
//     "Go there →" button (routes.ts checks the place and ids).
//
// Safe by design:
//   * Called with the person's own sign-in (verify_jwt on). Every read and write goes through a Supabase client that
//     carries THEIR sign-in and group, so the database rules (RLS) apply exactly as if they'd tapped the buttons.
//     The server key is used for one thing only: the usage log and the cap (helper_log, which the app can't touch).
//   * The model only gets a fixed list of read-only tools. It can't write: "Do it" / "Create it" is a separate call
//     from the app, and the plan is checked again before anything is made. No SQL, no deletes, no messages.
//   * Names from the database go to the model as data inside <data> tags, and the prompt says never to obey them.
//   * Cap (by default 2000 questions a group a month and 100 a person a day), checked before the model is called. The
//     feature switch 'ai_helper' must be on (and 'planner' for planning).
//   * Any provider (providers.ts), chosen by secrets: AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL (or the older
//     ANTHROPIC_API_KEY + AI_MODEL), and optional AI_GROUP_MONTHLY_CAP / AI_PERSON_DAILY_CAP. Not set: the helper
//     says it isn't on yet. Keys are never logged.
//
// The pure parts (prompts, tools, plan checks, cap maths, history and live summaries) are in logic.ts, plan.ts,
// live.ts and providers.ts, tested by logic.test.ts and providers.test.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  helperRequest, isUuid, zonedStart, zonedToday, planIds, shapeLibrary, shapeOwnCourses, clean, TZ, tripPlanIds, errorKind,
  type Deps, type PlanContext, type History,
} from './logic.ts';
import { aiConfig } from './providers.ts';
import { shapePastTrips, shapeNear } from './plan.ts';
import { commentaryRequest, commentaryCap } from './commentary.ts';
import { importRequest } from './import.ts';
import { jokesRequest, jokesCap } from './jokes.ts';
import { abSetup, pickAi } from './abtest.ts';
import { rulesRequest, rulesDeps } from './rules.ts';
import { coursebookRequest, coursebookDeps } from './coursebook.ts';
import { RESEARCH_COLS, withFacts, researchExtras, placeWord, pickGuide } from './research.ts';

const AI = aiConfig((k) => Deno.env.get(k));
if (!AI.ok) console.warn('ai-helper: AI provider not set up:', AI.reason); // the reason never includes a key
// A/B test of two models (abtest.ts, 075): AI_MODEL_B etc. Commentary and jokes (cron) always use A.
const AB = abSetup((k) => Deno.env.get(k), AI.ok ? AI.cfg : null);
if (AB.reason) console.warn('ai-helper: model B not on:', AB.reason);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The server key: ONLY for the usage log and the cap.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// deno-lint-ignore no-explicit-any
type Any = any;
const must = async <T>(q: PromiseLike<{ data: T; error: unknown }>): Promise<T> => {
  const { data, error } = await q;
  if (error) throw new Error((error as { message?: string }).message || 'Database error');
  return data;
};

/** Every row of one of the group's tables (PostgREST hands back 1000 at a time). */
async function allRows(db: SupabaseClient, g: string, table: string, cols: string, order: string[]) {
  const out: Any[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    let q = db.from(table).select(cols).eq('group_id', g);
    for (const o of order) q = q.order(o);
    const rows = (await must(q.range(from, from + 999))) as Any[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

function makeDeps(db: SupabaseClient, g: string, uid: string, status: Any): Deps {
  const ab = pickAi(AB, uid, fetch); // this person's model (A or B) for the whole request
  let own: PlanContext['courses'] | null = null;
  const ownCourses = async () => (own ||= (await must(db.from('courses').select('id,name,library_id,holes').eq('group_id', g).order('name'))) as Any[]);
  const library = async (id: string) => {
    const { data } = await db.rpc('library_course', { p_id: id });
    return data && data.id ? data : null;
  };
  const featureOn = async (key: string) => {
    const { data, error } = await db.rpc('feature_on', { p_group: g, p_key: key });
    return !error && data === true;
  };
  const searchLibrary = async (query: string, lat: number | null = null, lng: number | null = null, limit = 8) => {
    const args = { p_query: query, p_lat: lat, p_lng: lng, p_limit: limit };
    let { data, error } = await db.rpc('find_courses', args);
    if (error) ({ data, error } = await db.rpc('search_courses', args));
    if (error) throw new Error('The course library isn’t available just now.');
    return (data || []) as Any[];
  };
  // The group's own notes on each course's usual social golf times (080), so the helper can mention them.
  const withSocial = async (list: Any[]) => {
    const ids = list.map((c) => c.id).filter(Boolean);
    if (!ids.length) return list;
    const { data } = await db.from('course_social_times').select('course_id,weekdays,weekends,price,group_size').eq('group_id', g).in('course_id', ids);
    const by = Object.fromEntries((data || []).map((r: Any) => [r.course_id, [r.weekdays && `weekdays ${clean(r.weekdays, 60)}`, r.weekends && `weekends ${clean(r.weekends, 60)}`, clean(r.price, 30), clean(r.group_size, 40)].filter(Boolean).join(' · ')]));
    return list.map((c) => (by[c.id] ? { ...c, social_times: by[c.id] } : c));
  };
  // Josh's course research (088): read as the person (anyone signed in can). Before 088 is loaded the tables don't
  // exist; then there's simply no research and the planner works as before.
  const researchFor = async (ids: string[]) => {
    if (!ids.length) return [];
    const { data, error } = await db.from('course_research').select(RESEARCH_COLS).in('library_id', ids);
    return error ? [] : (data || []) as Any[];
  };
  const researchNear = async (place: string) => {
    const w = placeWord(place).replace(/\s+/g, '%');
    if (w.length < 3) return [];
    const { data, error } = await db.from('course_research').select(RESEARCH_COLS).or(`region.ilike.%${w}%,town.ilike.%${w}%`).limit(12);
    return error ? [] : (data || []) as Any[];
  };
  const addFacts = async <T extends { id: string }>(list: T[]) => withFacts(list, await researchFor(list.map((c) => c.id)));
  let guides: Any[] | null = null;
  const regionGuides = async () => {
    if (guides) return guides;
    const { data, error } = await db.from('region_guides').select('key,kind,title,state,regions,body').eq('active', true).order('sort');
    return (guides = error ? [] : (data || []) as Any[]);
  };
  // One place → the first library course there that has a location → courses near that point, with researched facts;
  // plus researched courses in that town or region the map search missed (listings with no map position yet).
  const nearOne = async (place: string) => {
    const hits = await searchLibrary(place, null, null, 5);
    let courses: Any[] = [];
    for (const h of hits.slice(0, 3)) {
      const l = await library(h.id);
      if (l?.lat != null && l?.lng != null) { courses = shapeNear(await searchLibrary('', Number(l.lat), Number(l.lng), 10)); break; }
    }
    if (!courses.length && hits.length) courses = shapeNear(hits);
    const extra = researchExtras(await researchNear(place), new Set(courses.map((c) => c.id)));
    courses = [...(await addFacts(courses)), ...extra];
    return courses.length ? { near: place, courses: await withSocial(courses) } : { near: place, courses: [], note: 'Nothing in the course library there yet — don’t search it again.' };
  };
  return {
    status: {
      is_member: !!status?.is_member, is_admin: !!status?.is_admin, group_id: status?.group_id || null, group_name: status?.group_name || null,
      player_name: status?.player_name || null, role: status?.role || null,
    },
    ai: ab.ai,
    fetchFn: ab.fetchFn,
    now: () => new Date(),
    featureOn,
    // Questions so far. Refused ones (cap hits) and ones the AI failed to answer don't count (Josh, 22 Oct: "it didn't
    // give an answer and it still took away a question"). Rows still being answered (no error yet) do count.
    usage: async () => {
      const now = new Date();
      const month = await admin.from('helper_log').select('id', { count: 'exact', head: true })
        .eq('group_id', g).in('mode', ['setup', 'history']).eq('capped', false).is('error', null).gte('created_at', zonedStart(now, 'month', TZ));
      const today = await admin.from('helper_log').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).in('mode', ['setup', 'history']).eq('capped', false).is('error', null).gte('created_at', zonedStart(now, 'day', TZ));
      if (month.error || today.error) throw new Error('Couldn’t check the helper’s limit');
      return { month: month.count || 0, today: today.count || 0 };
    },
    // The row goes in before the model is called, so two questions at once both count. Never any text.
    logStart: async (row) => {
      const ins = (extra: Any) => admin.from('helper_log').insert({
        group_id: g, user_id: uid, mode: row.mode, area: row.area, capped: false, ok: false, ...((row as Any).job ? { job: (row as Any).job } : {}),
        provider: row.provider ? clean(row.provider, 20) : null, model: row.model ? clean(row.model, 80) : null, ...extra,
      }).select('id').single();
      let { data, error } = await ins(ab.startCols()); // + variant and test (075)
      if (error) ({ data } = await ins({})); // 075 not applied yet: log as before
      return data?.id ?? null;
    },
    logEnd: async (id, row) => {
      if (id == null) return;
      const up = (extra: Any) => admin.from('helper_log').update({ ...row, error: row.error ? clean(row.error, 40) : null, ...extra }).eq('id', id);
      const { error } = await up(ab.endCols(row)); // + fallback and rough cost (075)
      if (error) await up({});
    },
    tripPlanContext: async (raw) => {
      const lib: Record<string, Any> = {};
      await Promise.all(tripPlanIds(raw).map(async (id) => { const l = await library(id); if (l) lib[id] = { id: l.id, name: l.name, area: l.area }; }));
      return { today: zonedToday(new Date(), TZ), library: lib, tasksOn: await featureOn('planner_tasks') };
    },
    planTool: async (name, input) => {
      if (name === 'our_players') {
        const ps = (await must(db.from('players').select('name,nickname,approved').eq('group_id', g))) as Any[];
        const ok = ps.filter((p) => p.approved !== false);
        return { count: ok.length, names: ok.slice(0, 100).map((p) => clean(p.nickname || p.name, 40)) };
      }
      if (name === 'past_trips') {
        const [trips, plans, rounds, courses] = await Promise.all([
          must(db.from('trips').select('id,name,start_date,end_date').eq('group_id', g)) as Promise<Any[]>,
          must(db.from('plans').select('name,kind,start_date,end_date,location_name,status,budget_pp,trip_id').eq('group_id', g)) as Promise<Any[]>,
          must(db.from('rounds').select('trip_id,course_id').eq('group_id', g)) as Promise<Any[]>,
          ownCourses(),
        ]);
        return shapePastTrips(trips, plans, rounds, courses);
      }
      if (name === 'find_course') return addFacts(shapeNear(await searchLibrary(clean(input?.query, 60))));
      if (name === 'region_guide') return pickGuide(await regionGuides(), clean(input?.region, 60));
      if (name === 'courses_near') {
        // ov16: several places in one call (up to 4), so the helper doesn't spend a turn on each.
        const many = Array.isArray(input?.places) ? [...new Set((input.places as unknown[]).map((p) => clean(p, 60)).filter(Boolean))].slice(0, 4) : [];
        if (many.length > 1 || (many.length === 1 && !input?.place)) {
          return { results: await Promise.all(many.map((p) => nearOne(p))) };
        }
        return nearOne(clean(input?.place ?? many[0], 60));
      }
      throw new Error('No such tool');
    },
    libraryInfo: async () => {
      // The person's own client: the search hands back at most 50, so "50+" means a big list.
      const rows = await searchLibrary('', null, null, 50).catch(() => null);
      return rows ? { courses: rows.length, more: rows.length >= 50 } : null;
    },
    planDb: {
      insertPlan: async (row) => ((await must(db.from('plans').insert(row).select('id').single())) as Any).id,
      startVotes: async (planId, dates, places, closes) => { await must(db.rpc('start_trip_votes', { p_plan: planId, p_dates: dates, p_places: places, p_closes_on: closes })); },
      insertItems: async (rows) => { await must(db.from('plan_items').insert(rows)); },
      rsvpIn: async (planId) => { if (status?.player_id) await must(db.from('plan_rsvps').upsert({ plan_id: planId, player_id: status.player_id, status: 'in' })); },
      post: async (planId, body) => { if (status?.player_id) await db.from('posts').insert({ kind: 'user', player_id: status.player_id, link: `/plan/${planId}`, body }); },
    },
    planContext: async (raw) => {
      const [courses, trips, sideComps] = await Promise.all([
        ownCourses(),
        must(db.from('trips').select('id,name,start_date,end_date').eq('group_id', g)) as Promise<Any[]>,
        featureOn('side_comps'),
      ]);
      const lib: PlanContext['library'] = {};
      const unknown = planIds(raw).filter((id) => !courses.some((c) => c.id === id));
      await Promise.all(unknown.map(async (id) => { const l = await library(id); if (l) lib[id] = l; }));
      return { courses, library: lib, trips, today: zonedToday(new Date(), TZ), sideComps };
    },
    setupTool: async (name, input) => {
      if (name === 'find_course') {
        const args = { p_query: clean(input?.query, 60), p_lat: null, p_lng: null, p_limit: 8 };
        let { data, error } = await db.rpc('find_courses', args);
        if (error) ({ data, error } = await db.rpc('search_courses', args));
        if (error) throw new Error('The course library isn’t available just now.');
        const rows = (data || []) as Any[];
        // The par 3s of the top few (for "closest to the pin on the par 3s").
        const holesById: Record<string, Any[]> = {};
        await Promise.all(rows.slice(0, 4).filter((r) => r.holes > 0).map(async (r) => { const l = await library(r.id); if (l) holesById[r.id] = l.holes || []; }));
        return shapeLibrary(rows, await ownCourses(), holesById);
      }
      if (name === 'our_courses') return shapeOwnCourses(await ownCourses());
      if (name === 'our_trips') {
        const [trips, rounds] = await Promise.all([
          must(db.from('trips').select('id,name,start_date,end_date').eq('group_id', g).order('start_date', { ascending: false, nullsFirst: false }).limit(20)) as Promise<Any[]>,
          must(db.from('rounds').select('trip_id').eq('group_id', g)) as Promise<Any[]>,
        ]);
        return trips.map((t) => ({ id: t.id, name: clean(t.name, 60), start_date: t.start_date, end_date: t.end_date, rounds: rounds.filter((r) => r.trip_id === t.id).length }));
      }
      if (name === 'our_players') {
        const ps = (await must(db.from('players').select('name,nickname,approved').eq('group_id', g))) as Any[];
        const ok = ps.filter((p) => p.approved !== false);
        return { count: ok.length, names: ok.slice(0, 100).map((p) => clean(p.nickname || p.name, 40)) };
      }
      throw new Error('No such tool');
    },
    history: async () => {
      const [trips, rounds, courses, players, round_players, teams, team_players, scores, quick_results, honour_board, handicap_history] = await Promise.all([
        allRows(db, g, 'trips', 'id,name,start_date,end_date,status', ['id']),
        allRows(db, g, 'rounds', 'id,trip_id,course_id,name,play_date,format,status', ['id']),
        allRows(db, g, 'courses', 'id,name,holes', ['id']),
        allRows(db, g, 'players', 'id,name,nickname,handicap,approved', ['id']),
        allRows(db, g, 'round_players', 'round_id,player_id,playing_handicap', ['round_id', 'player_id']),
        allRows(db, g, 'teams', 'id,round_id,name,handicap', ['id']),
        allRows(db, g, 'team_players', 'team_id,player_id', ['team_id', 'player_id']),
        allRows(db, g, 'scores', 'round_id,subject_id,hole,strokes,picked_up', ['round_id', 'subject_id', 'hole']),
        allRows(db, g, 'quick_results', 'round_id,player_id,points', ['round_id', 'player_id']),
        allRows(db, g, 'honour_board', 'trophy_name,label,winner_names,player_ids,sort_key', ['id']),
        allRows(db, g, 'handicap_history', 'player_id,old_handicap,new_handicap,reason,created_at', ['id']),
      ]);
      return { trips, rounds, courses, players, round_players, teams, team_players, scores, quick_results, honour_board, handicap_history } as History;
    },
    // The Caddie's go_to (routes.ts): the group's trip plans, read as the person (so only their group's).
    plans: async () => (await must(db.from('plans').select('id,name,trip_id').eq('group_id', g).limit(200))) as Any[],
    applyDb: {
      insertTrip: async (row) => ((await must(db.from('trips').insert(row).select('id').single())) as Any).id,
      copyLibraryCourse: async (libraryId) => (await must(db.rpc('copy_library_course', { p_id: libraryId }))) as string,
      insertRound: async (row) => { await must(db.from('rounds').insert(row)); },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  // Live commentary (071): the database's every-minute job, with the server's cron secret — not a person. See commentary.ts.
  // Running jokes (072): the database's daily job, {"type":"jokes"} with the same secret. See jokes.ts.
  if (req.headers.get('x-cron-secret') && (await req.clone().json().catch(() => null))?.type === 'jokes') { const r = await jokesRequest(req, admin, AI.ok ? AI.cfg : null, jokesCap((k) => Deno.env.get(k))); return json(r.body, r.status); }
  if (req.headers.get('x-cron-secret')) { const r = await commentaryRequest(req, admin, SUPABASE_URL, AI.ok ? AI.cfg : null, commentaryCap((k) => Deno.env.get(k))); return json(r.body, r.status); }
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Unknown request.' }, 400);
  const group = isUuid(body.group_id) ? String(body.group_id) : null;

  // The person's own client: their sign-in and the group they're working in. The database checks both.
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, ...(group ? { 'x-group-id': group } : {}) } },
  });
  const { data: who } = await db.auth.getUser(token);
  if (!who?.user) return json({ error: 'Sign in first.' }, 401);
  const { data: status, error } = await db.rpc('my_status');
  if (error || !status) return json({ error: 'Couldn’t check who you are — try again.' });
  if (group && status.group_id !== group) return json({ error: 'You’re not in this group.' });
  // Who's asking (so "what do I need?" works on the Ask screen). Just the name; it goes to the model as data.
  if (status.player_id && /^(history|ask)$/.test(String(body.mode))) {
    const { data: me } = await db.from('players').select('name,nickname').eq('id', status.player_id).maybeSingle();
    status.player_name = me ? (me.nickname || me.name) : null;
  }

  try {
    // "Bring your history" (import.ts): text and photos read into a proposal the organiser confirms in the app.
    if (body.mode === 'import') return json(await importRequest(body, { ...makeDeps(db, status.group_id, who.user.id, status), visionModel: Deno.env.get('AI_VISION_MODEL') || null }));
    if (body.mode === 'course_lookup') return json(await coursebookRequest(body, coursebookDeps(makeDeps(db, status.group_id, who.user.id, status), db))); // "✨ Look it up" in the trip builder (coursebook.ts)
    if (/^rules_/.test(String(body.mode))) return json(await rulesRequest(body, rulesDeps(makeDeps(db, status.group_id, who.user.id, status), db, status.group_id))); // The Rulebook's AI jobs (rules.ts)
    return json(await helperRequest(body, makeDeps(db, status.group_id, who.user.id, status)));
  } catch (e) {
    console.error('ai-helper failed:', errorKind(e)); // only the kind of error: never values, text or keys
    return json({ error: 'The Caddie hit a snag — try again in a minute.' });
  }
});
