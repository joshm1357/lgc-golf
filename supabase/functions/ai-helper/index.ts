// ai-helper — the AI helper inside the app (21 Oct 2026). Two jobs:
//   * "Set it up for me" (organisers): plain words → a setup plan (trip, courses, rounds, side comps). Nothing is
//     saved until the organiser taps "Do it", which calls this function again with { mode: 'apply', plan }.
//   * "Ask about our history" (anyone in the group): answers questions from the group's own trips, rounds and
//     honour boards.
//
// Safe by design:
//   * Called with the person's own sign-in (verify_jwt on). Every read and write goes through a Supabase client that
//     carries THEIR sign-in and group, so the database rules (RLS) apply exactly as if they'd tapped the buttons.
//     The server key is used for one thing only: the usage log and the cap (helper_log, which the app can't touch).
//   * The model only gets a fixed list of read-only tools. It can't write: "Do it" is a separate call from the app,
//     and the plan is checked again before anything is made. No SQL, no deletes, no messages.
//   * Names from the database go to the model as data inside <data> tags, and the prompt says never to obey them.
//   * Cap: 60 questions a group a month and 10 a person a day, checked before the model is called. The feature
//     switch 'ai_helper' must be on.
//   * The Anthropic key is the Supabase secret ANTHROPIC_API_KEY. Not set: the helper says it isn't on yet.
//
// The pure parts (prompts, tools, plan checks, cap maths, history summaries) are in logic.ts, tested by logic.test.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  helperRequest, isUuid, zonedStart, zonedToday, planIds, shapeLibrary, shapeOwnCourses, clean, TZ,
  type Deps, type PlanContext, type History,
} from './logic.ts';

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
  return {
    status: { is_member: !!status?.is_member, is_admin: !!status?.is_admin, group_id: status?.group_id || null, group_name: status?.group_name || null },
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') || null,
    fetchFn: fetch,
    now: () => new Date(),
    featureOn: () => featureOn('ai_helper'),
    usage: async () => {
      const now = new Date();
      const month = await admin.from('helper_log').select('id', { count: 'exact', head: true })
        .eq('group_id', g).in('mode', ['setup', 'history']).gte('created_at', zonedStart(now, 'month', TZ));
      const today = await admin.from('helper_log').select('id', { count: 'exact', head: true })
        .eq('user_id', uid).in('mode', ['setup', 'history']).gte('created_at', zonedStart(now, 'day', TZ));
      if (month.error || today.error) throw new Error('Couldn’t check the helper’s limit');
      return { month: month.count || 0, today: today.count || 0 };
    },
    // The row goes in before the model is called, so two questions at once both count.
    logStart: async (mode) => {
      const { data } = await admin.from('helper_log').insert({ group_id: g, user_id: uid, mode, ok: false }).select('id').single();
      return data?.id ?? null;
    },
    logEnd: async (id, row) => {
      if (id != null) await admin.from('helper_log').update(row).eq('id', id);
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
        return { count: ok.length, names: ok.slice(0, 40).map((p) => clean(p.nickname || p.name, 40)) };
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

  try {
    return json(await helperRequest(body, makeDeps(db, status.group_id, who.user.id, status)));
  } catch (e) {
    console.error('ai-helper failed:', (e as Error)?.message); // never the request text, never the key
    return json({ error: 'The AI helper hit a snag — try again in a minute.' });
  }
});
