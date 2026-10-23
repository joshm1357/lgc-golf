// lgc-mcp — the Claude connector: lets a Claude chat run ONE group's app through a short list of
// safe actions (read the leaderboard, enter a card, confirm a comp winner, post to the feed,
// organise a trip) instead of having full database access.
//
// Connect it in Claude: Settings → Connectors → Add custom connector → paste the secret link
// https://<project>.supabase.co/functions/v1/lgc-mcp/<key>. Each key belongs to one group
// (connector_keys, stored as a SHA-256 hash) and can only see and change that group. Anyone with
// the link acts as that group's organiser, so keep it private; delete its row to cut it off.
//
// Learning loop (057): every tool call is logged as counts only (group, tool, worked or not, time, a short error
// kind — never what was asked), and suggest_feature saves a one-line job no tool can do yet. Josh sees both on the
// Wishes screen (platform admins only).
//
// Protocol: MCP over plain HTTP (JSON-RPC 2.0, JSON responses — no streaming needed).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
// Trip finder (Stage 16): the same ranking the app uses (pure maths, shared with the app and its tests).
import { searchBox, findCourses, pickFacts, factLine, startsText, defaultDay, FACTS } from '../../../src/lib/tripfinder.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };

// Which group a key belongs to. Looked up again after a minute, so removing a key cuts it off fast.
type Ctx = { g: string; author: string | null; groupName: string };
const keyCache = new Map<string, { ctx: Ctx | null; at: number }>();
async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function ctxForKey(key: string | undefined): Promise<Ctx | null> {
  if (!key || key.length < 16) return null;
  const hit = keyCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.ctx;
  const { data } = await db.from('connector_keys').select('group_id, player_id, groups(name)').eq('key_hash', await sha256(key)).maybeSingle();
  let ctx = data ? { g: data.group_id as string, author: (data.player_id as string) || null, groupName: (data as any).groups?.name || 'the group' } : null;
  // The group can switch the connector off (Stage 3). An older database without switches: on.
  if (ctx) {
    const { data: on, error } = await db.rpc('feature_on', { p_group: ctx.g, p_key: 'connector' });
    if (!error && on === false) ctx = null;
  }
  // Only remember keys that work (and not too many), so random wrong keys can't fill the memory.
  if (ctx) {
    if (keyCache.size > 200) keyCache.clear();
    keyCache.set(key, { ctx, at: Date.now() });
  }
  return ctx;
}

// ---------- helpers ----------
type P = { id: string; name: string; nickname?: string; handicap?: number; approved?: boolean };
const fail = (msg: string) => { throw new Error(msg); };
const must = async <T>(q: PromiseLike<{ data: T; error: unknown }>) => {
  const { data, error } = await q;
  if (error) throw Object.assign(new Error((error as { message?: string }).message || 'Database error'), { kind: 'database' });
  return data;
};

// ---------- the learning loop (057): which tools organisers use, and what they wish they could do ----------
// Each tool call is logged as group + tool + worked or not + how long + a short error KIND. Never the arguments, never
// the error's wording (it can name players), never any chat text. Logging is fire-and-forget: it can't slow or break
// a call, and an older database without the table just doesn't log.
/** A short, name-free label for why a tool call failed. */
function errorKind(e: unknown): string {
  const kind = (e as { kind?: string })?.kind;
  if (kind) return kind;
  const m = String((e as Error)?.message || e || '');
  if (/^No (such|player|team|rounds)|isn't in /i.test(m)) return 'not_found';
  if (/could be|matches .* and |more specific/i.test(m)) return 'ambiguous';
  if (/is locked/i.test(m)) return 'locked';
  if (/isn't 1–18|doesn't look right|^Say which|^No scores given|^Amount must|^Nothing to|^Describe the job/i.test(m)) return 'bad_input';
  return 'other';
}
function logCall(c: Ctx, tool: string, ok: boolean, started: number, error: string | null = null) {
  try {
    const p = db.from('connector_calls').insert({
      group_id: c.g, tool: tool.slice(0, 60), ok, ms: Math.max(0, Math.round(performance.now() - started)),
      error: ok ? null : (error || 'other').slice(0, 40),
    }).then(() => {}, () => {});
    // Keep the function alive until the row is written, even after the answer has gone back.
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: PromiseLike<unknown>) => void } }).EdgeRuntime?.waitUntil?.(p);
  } catch { /* logging never breaks a call */ }
}
/** The wish as one plain line: no email addresses, phone numbers or links, at most 200 characters. */
function cleanJob(text: unknown): string {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '')
    .replace(/\+?\d[\d\s()-]{6,}\d/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trim();
}
const WISHES_PER_DAY = 50; // per group: a runaway assistant can't flood the list
async function players(c: Ctx): Promise<P[]> {
  return ((await must(db.from('players').select('id,name,nickname,handicap,approved').eq('group_id', c.g))) as P[]).filter((p) => p.approved !== false);
}
/** A plan of THIS group, or a clear error. */
async function planOf(c: Ctx, id: string) {
  const { data } = await db.from('plans').select('*').eq('id', id).eq('group_id', c.g).maybeSingle();
  return (data as Record<string, any>) || fail('No such plan in this group — check the id with lgc_overview.');
}
const pname = (p?: P) => (p ? p.nickname || p.name : 'Unknown');
function findPlayer(all: P[], who: string) {
  const w = String(who || '').trim().toLowerCase();
  if (!w) fail('Say which player.');
  const exact = all.filter((p) => p.id === who || p.name.toLowerCase() === w || (p.nickname || '').toLowerCase() === w);
  if (exact.length === 1) return exact[0];
  const part = all.filter((p) => p.name.toLowerCase().includes(w) || (p.nickname || '').toLowerCase().includes(w) || p.name.toLowerCase().split(' ')[0] === w);
  if (part.length === 1) return part[0];
  if (!part.length) fail(`No player called "${who}". Players: ${all.map(pname).join(', ')}.`);
  return fail(`"${who}" could be ${part.map(pname).join(' or ')} — be more specific.`);
}
function strokesReceived(hcp: number, si: number) {
  const h = Math.round(Number(hcp) || 0);
  if (h >= 0) return Math.floor(h / 18) + (si <= h % 18 ? 1 : 0);
  return -(19 - si <= -h ? 1 : 0);
}
async function currentRound(c: Ctx, roundId?: string) {
  if (roundId) {
    const { data } = await db.from('rounds').select('*').eq('id', roundId).eq('group_id', c.g).maybeSingle();
    return (data as Record<string, any>) || fail('No such round in this group — check the id with lgc_overview.');
  }
  const { data: live } = await db.from('rounds').select('*').eq('group_id', c.g).eq('status', 'live').order('play_date', { ascending: false }).limit(1);
  if (live?.length) return live[0];
  const { data: last } = await db.from('rounds').select('*').eq('group_id', c.g).order('play_date', { ascending: false, nullsFirst: false }).limit(1);
  return last?.[0] || fail('No rounds yet.');
}
async function subjectsOf(round: Record<string, unknown>, all: P[]) {
  if (round.format === 'ambrose') {
    const teams = (await must(db.from('teams').select('*, team_players(player_id)').eq('round_id', round.id))) as { id: string; name: string; handicap: number; team_players: { player_id: string }[] }[];
    return teams.map((t) => ({ id: t.id, type: 'team', name: t.name, handicap: Number(t.handicap), members: t.team_players.map((x) => all.find((p) => p.id === x.player_id)).filter(Boolean) as P[] }));
  }
  const rps = (await must(db.from('round_players').select('*').eq('round_id', round.id))) as { player_id: string; playing_handicap: number }[];
  if (round.format === 'fourball') {
    // 4BBB: each player in each pair scores their own ball, off the round's playing handicap (else their handicap).
    const hcp = Object.fromEntries(rps.map((rp) => [rp.player_id, Number(rp.playing_handicap)]));
    const teams = (await must(db.from('teams').select('*, team_players(player_id)').eq('round_id', round.id))) as { id: string; name: string; team_players: { player_id: string }[] }[];
    return teams.flatMap((t) => t.team_players.map((x) => {
      const p = all.find((y) => y.id === x.player_id);
      return { id: x.player_id, type: 'player', name: pname(p), handicap: hcp[x.player_id] ?? Math.round(Number(p?.handicap || 0)), members: p ? [p] : [], pair: t.name, pairId: t.id };
    }));
  }
  return rps.map((rp) => { const p = all.find((x) => x.id === rp.player_id); return { id: rp.player_id, type: 'player', name: pname(p), handicap: Number(rp.playing_handicap), members: p ? [p] : [] }; });
}
function findSubject(subs: Awaited<ReturnType<typeof subjectsOf>>, who: string) {
  const w = String(who || '').trim().toLowerCase();
  const hit = subs.filter((s) => s.id === who || s.name.toLowerCase() === w);
  if (hit.length === 1) return hit[0];
  const part = subs.filter((s) => s.name.toLowerCase().includes(w) || s.members.some((m) => m.name.toLowerCase().includes(w) || (m.nickname || '').toLowerCase() === w));
  if (part.length === 1) return part[0];
  return fail(part.length ? `"${who}" matches ${part.map((s) => s.name).join(' and ')}.` : `No team or player "${who}" in this round. In it: ${subs.map((s) => s.name).join(', ')}.`);
}
/** Feature switches (Stage 3). The connector uses the server key, which skips the database's rules, so it checks
 *  here: a tool for a switched-off feature isn't offered and refuses to run. (An older database: everything on.) */
async function featureOn(c: Ctx, key: string) {
  const { data, error } = await db.rpc('feature_on', { p_group: c.g, p_key: key });
  return error ? true : data !== false;
}
const TOOL_FEATURE: Record<string, string> = {
  confirm_side_comp: 'side_comps', post_to_feed: 'feed', plan_details: 'planner', set_rsvp: 'planner',
  add_job: 'planner_tasks', create_poll: 'planner_tasks', add_cost: 'planner_costs',
  find_courses: 'trip_finder', get_course_facts: 'trip_finder', propose_course_fact: 'trip_finder',
  raise_case: 'tribunal', list_cases: 'tribunal', read_verdict: 'tribunal',
};
async function post(c: Ctx, text: string) {
  if (!(await featureOn(c, 'feed'))) return; // no feed: nothing to post to
  await must(db.from('posts').insert({ group_id: c.g, kind: 'user', player_id: c.author, body: text }));
}

// ---------- the tools ----------
type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: Record<string, any>, c: Ctx) => Promise<string> };
const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });

const TOOLS: Tool[] = [
  {
    name: 'lgc_overview',
    description: 'Start here. The current trip, its rounds (ids, course, format, status, teams/players with handicaps) and the trips and rounds being planned.',
    inputSchema: { type: 'object', properties: {} },
    async run(_a, c) {
      const all = await players(c);
      const trips = await must(db.from('trips').select('*').eq('group_id', c.g).order('start_date', { ascending: false })) as Record<string, any>[];
      const trip = trips.find((t) => t.status === 'active') || trips[0];
      const rounds = trip ? await must(db.from('rounds').select('*, courses(name)').eq('trip_id', trip.id).eq('group_id', c.g).order('play_date')) as Record<string, any>[] : [];
      const lines = [`Group: ${c.groupName}`, `Current trip: ${trip ? `${trip.name} (${trip.start_date || '?'} to ${trip.end_date || '?'})` : 'none'}`];
      for (const r of rounds) {
        const subs = await subjectsOf(r, all);
        lines.push(`- Round "${r.name}" id=${r.id} · ${r.courses?.name} · ${r.format} · ${r.status} · ${r.play_date || ''}${r.comp_bonus ? ` · side comps −${r.comp_bonus}` : ''}${r.ctp_holes?.length ? ` · CTP ${r.ctp_holes.join(',')}` : ''}${r.ld_holes?.length ? ` · LD ${r.ld_holes.join(',')}` : ''}`);
        for (const s of subs as any[]) lines.push(`    ${s.name} (hcp ${s.handicap})${s.type === 'team' ? `: ${s.members.map(pname).join(', ')}` : s.pair ? ` — pair ${s.pair}` : ''}`);
      }
      const plans = await must(db.from('plans').select('id,name,kind,status,start_date,end_date,location_name,proposed').eq('group_id', c.g).neq('status', 'cancelled').order('start_date', { nullsFirst: false })) as Record<string, any>[];
      lines.push('Trips (ideas, being decided, locked in, past):');
      for (const p of plans) lines.push(`- ${p.proposed ? '[suggested] ' : ''}${p.name} id=${p.id} · ${p.kind} · ${p.status} · ${p.start_date || 'dates TBC'} · ${p.location_name || 'location TBC'}`);
      lines.push(`Players: ${all.map((p) => `${pname(p)} (${p.handicap})`).join(', ')}`);
      return lines.join('\n');
    },
  },
  {
    name: 'get_leaderboard',
    description: 'The scores for a round (default: the live round, else the latest). Gross, holes played, handicap and net (Ambrose), net to par (stroke play), Stableford points, or better-ball points per pair (4BBB).',
    inputSchema: { type: 'object', properties: { round_id: str('Round id (optional)') } },
    async run(a, c) {
      const round = await currentRound(c, a.round_id);
      const course = await must(db.from('courses').select('*').eq('id', round.course_id).eq('group_id', c.g).single()) as Record<string, any>;
      const subs = await subjectsOf(round, await players(c));
      const scores = await must(db.from('scores').select('*').eq('round_id', round.id)) as Record<string, any>[];
      const holes = course.holes as { n: number; par: number; si: number }[];
      // Side comps (Ambrose): the winner's team takes comp_bonus strokes off — confirmed winner first, else best distance.
      const bonus: Record<string, string[]> = {};
      if (round.format === 'ambrose' && round.comp_bonus) {
        const entries = await must(db.from('side_entries').select('*').eq('round_id', round.id)) as Record<string, any>[];
        for (const [kind, list] of [['ctp', round.ctp_holes || []], ['ld', round.ld_holes || []]] as const) {
          for (const hole of list as number[]) {
            const here = entries.filter((e) => e.kind === kind && e.hole === hole);
            const best = here.find((e) => e.confirmed) || here.filter((e) => e.distance_m != null).sort((x, y) => (kind === 'ctp' ? x.distance_m - y.distance_m : y.distance_m - x.distance_m))[0];
            const team = best && subs.find((t) => t.members.some((m) => m.id === best.player_id));
            if (team) (bonus[team.id] ||= []).push(`${kind.toUpperCase()} ${hole}`);
          }
        }
      }
      const stab = (h: { par: number; si: number }, x: Record<string, any>, hcp: number) =>
        (x.picked_up || x.strokes == null ? 0 : Math.max(0, 2 + h.par + strokesReceived(hcp, h.si) - x.strokes));
      if (round.format === 'fourball') {
        // 4BBB: per pair, the better points on each hole once both have a score (or picked up).
        const pairs = new Map<string, { name: string; members: typeof subs }>();
        for (const sub of subs as any[]) {
          if (!pairs.has(sub.pairId)) pairs.set(sub.pairId, { name: sub.pair, members: [] });
          pairs.get(sub.pairId)!.members.push(sub);
        }
        const prow = [...pairs.values()].map((pr) => {
          let pts = 0; let thru = 0;
          for (const h of holes) {
            const each = pr.members.map((m) => scores.find((x) => x.subject_id === m.id && x.hole === h.n));
            if (each.some((x) => !x || (x.strokes == null && !x.picked_up))) continue;
            pts += Math.max(...each.map((x, i) => stab(h, x!, pr.members[i].handicap)));
            thru += 1;
          }
          return { pr, pts, thru };
        }).sort((x, y) => y.pts - 2 * y.thru - (x.pts - 2 * x.thru));
        return [`${round.name} (4BBB, better-ball Stableford, ${round.status}) at ${course.name}`,
          ...prow.map((r, i) => `${i + 1}. ${r.pr.name} (${r.pr.members.map((m) => `${m.name} off ${m.handicap}`).join(', ')}) — thru ${r.thru} · ${r.pts} pts (${r.pts - 2 * r.thru >= 0 ? '+' : ''}${r.pts - 2 * r.thru} on 2 a hole)`)].join('\n');
      }
      const rows = subs.map((s) => {
        const mine = scores.filter((x) => x.subject_id === s.id);
        const played = mine.filter((x) => x.strokes != null || x.picked_up);
        const gross = mine.reduce((t, x) => t + (x.strokes || 0), 0);
        const par = played.reduce((t, x) => t + (holes.find((h) => h.n === x.hole)?.par || 0), 0);
        if (round.format === 'ambrose') {
          const recv = played.reduce((t, x) => t + strokesReceived(s.handicap, holes.find((h) => h.n === x.hole)?.si || 18), 0);
          const off = (bonus[s.id] || []).length * Number(round.comp_bonus || 0);
          const net = (played.length === holes.length ? gross - s.handicap : gross - recv) - off;
          return { s, played: played.length, gross, toPar: gross - par, net, sort: net - par, comps: bonus[s.id] || [] };
        }
        if (round.format === 'stroke') {
          // Stroke play: net to par through the holes played; a pick-up counts as net double bogey.
          let netToPar = 0; let g = 0;
          for (const x of played) {
            const h = holes.find((hh) => hh.n === x.hole);
            if (!h) continue;
            const recv = strokesReceived(s.handicap, h.si);
            netToPar += x.picked_up ? 2 : x.strokes - h.par - recv;
            g += x.picked_up ? h.par + 2 + recv : x.strokes;
          }
          return { s, played: played.length, gross: g, toPar: g - par, netToPar, sort: netToPar };
        }
        const pts = mine.reduce((t, x) => {
          const h = holes.find((hh) => hh.n === x.hole);
          if (!h || x.strokes == null) return t;
          return t + Math.max(0, 2 + h.par + strokesReceived(s.handicap, h.si) - x.strokes);
        }, 0);
        return { s, played: played.length, gross, toPar: gross - par, points: pts, sort: -pts };
      }).sort((x, y) => x.sort - y.sort);
      const head = `${round.name} (${round.format}, ${round.status}) at ${course.name}, par ${holes.reduce((t, h) => t + h.par, 0)}${round.comp_bonus ? `. Side comps worth −${round.comp_bonus}, already taken off the net below` : ''}`;
      return [head, ...rows.map((r, i) => `${i + 1}. ${r.s.name} — thru ${r.played} · gross ${r.gross} (${r.toPar >= 0 ? '+' : ''}${r.toPar}) · hcp ${r.s.handicap} · ${'netToPar' in r ? `net ${(r as any).netToPar > 0 ? '+' : ''}${(r as any).netToPar === 0 ? 'E' : (r as any).netToPar} to par` : 'points' in r ? `${r.points} pts` : `net ${Math.round((r.net as number) * 10) / 10}${(r as any).comps?.length ? ` (incl. ${(r as any).comps.join(', ')})` : ''}`}`)].join('\n');
    },
  },
  {
    name: 'enter_scores',
    description: 'Enter or correct hole scores for one team (Ambrose) or player (Stableford, stroke play, or one player of a 4BBB pair), e.g. from a photo of a scorecard. Overwrites those holes. Optionally who drove (Ambrose minimum-drives rule).',
    inputSchema: {
      type: 'object', required: ['who', 'scores'],
      properties: {
        round_id: str('Round id (optional: the live round)'),
        who: str('Team name (Ambrose) or player name (Stableford)'),
        scores: { type: 'array', items: { type: 'object', required: ['hole', 'strokes'], properties: { hole: num('1–18'), strokes: num('Strokes, 1–15; 0 = picked up (Stableford, 4BBB; in stroke play it counts as net double bogey)'), drive_by: str('Ambrose: player whose tee shot was used (optional)') } } },
      },
    },
    async run(a, c) {
      const round = await currentRound(c, a.round_id);
      if (round.status === 'locked') fail(`"${round.name}" is locked. Reopen it in Organiser tools first.`);
      const all = await players(c);
      const subject = findSubject(await subjectsOf(round, all), a.who);
      const rows = (a.scores || []).map((x: Record<string, any>) => {
        const hole = Number(x.hole);
        const strokes = Number(x.strokes);
        if (!(hole >= 1 && hole <= 18)) fail(`Hole ${x.hole} isn't 1–18.`);
        if (!(strokes >= 0 && strokes <= 15)) fail(`Hole ${hole}: ${x.strokes} strokes doesn't look right.`);
        const row: Record<string, unknown> = { round_id: round.id, subject_id: subject.id, subject_type: subject.type, hole, strokes: strokes || null, picked_up: strokes === 0 };
        if (x.drive_by && round.format === 'ambrose') {
          const d = subject.members.find((m) => m.id === x.drive_by || m.name.toLowerCase().includes(String(x.drive_by).toLowerCase()) || (m.nickname || '').toLowerCase() === String(x.drive_by).toLowerCase());
          if (!d) fail(`Hole ${hole}: ${x.drive_by} isn't in ${subject.name}.`);
          row.tee_shot_player = d!.id;
        }
        return row;
      });
      if (!rows.length) fail('No scores given.');
      await must(db.from('scores').upsert(rows, { onConflict: 'round_id,subject_id,hole' }));
      const gross = rows.reduce((t: number, r: Record<string, any>) => t + (r.strokes || 0), 0);
      return `Saved ${rows.length} hole${rows.length === 1 ? '' : 's'} for ${subject.name} in "${round.name}" (these holes add to ${gross}). Everyone's leaderboard updates live.`;
    },
  },
  {
    name: 'confirm_side_comp',
    description: 'Record and confirm the winner of closest to pin (ctp) or longest drive (ld) on a hole. A confirmed winner beats any measured distance.',
    inputSchema: { type: 'object', required: ['kind', 'hole', 'player'], properties: { round_id: str('Round id (optional)'), kind: { type: 'string', enum: ['ctp', 'ld'] }, hole: num('Hole'), player: str('Winner'), distance_m: num('Distance in metres (optional)') } },
    async run(a, c) {
      const round = await currentRound(c, a.round_id);
      const p = findPlayer(await players(c), a.player);
      await must(db.from('side_entries').update({ confirmed: false }).eq('round_id', round.id).eq('kind', a.kind).eq('hole', a.hole));
      await must(db.from('side_entries').insert({ round_id: round.id, kind: a.kind, hole: a.hole, player_id: p.id, distance_m: a.distance_m ?? null, confirmed: true }));
      const what = a.kind === 'ctp' ? 'closest to pin' : 'longest drive';
      await post(c, `${a.kind === 'ctp' ? '🎯' : '💣'} ${pname(p)} takes ${what} on ${a.hole}${a.distance_m ? ` (${a.distance_m} m)` : ''}.`);
      return `Confirmed ${pname(p)} as ${what} winner on hole ${a.hole} and posted it to the feed.`;
    },
  },
  {
    name: 'post_to_feed',
    description: 'Post a message to the group feed (as the organiser).',
    inputSchema: { type: 'object', required: ['text'], properties: { text: str('The message') } },
    async run(a, c) {
      if (!String(a.text || '').trim()) fail('Nothing to post.');
      await post(c, String(a.text).trim().slice(0, 1000));
      return 'Posted to the feed.';
    },
  },
  {
    name: 'plan_details',
    description: "One planned trip or round: who's in, votes with tallies, jobs, costs and who owes what.",
    inputSchema: { type: 'object', required: ['plan_id'], properties: { plan_id: str('Plan id from lgc_overview') } },
    async run(a, c) {
      const all = await players(c);
      const pl = await planOf(c, a.plan_id);
      const by = (t: string) => db.from(t).select('*').eq('plan_id', pl.id);
      const [rs, polls, items, costs] = await Promise.all([must(by('plan_rsvps')), must(by('plan_polls')), must(by('plan_items')), must(by('plan_costs'))]) as Record<string, any>[][];
      const pollIds = polls.map((p) => p.id);
      const [opts, votes] = pollIds.length ? await Promise.all([must(db.from('plan_options').select('*').in('poll_id', pollIds)), must(db.from('plan_votes').select('*').in('poll_id', pollIds))]) as Record<string, any>[][] : [[], []];
      const nm = (id: string) => pname(all.find((p) => p.id === id));
      const lines = [`${pl.name} · ${pl.kind} · ${pl.status}${pl.proposed ? ' (suggested)' : ''} · ${pl.start_date || 'dates TBC'}${pl.end_date && pl.end_date !== pl.start_date ? ` to ${pl.end_date}` : ''} · ${pl.location_name || 'location TBC'}${pl.rsvp_locked ? ' · list locked' : ''}`];
      for (const s of ['in', 'maybe', 'out']) lines.push(`${s.toUpperCase()}: ${rs.filter((r) => r.status === s).map((r) => nm(r.player_id)).join(', ') || '—'}`);
      const replied = new Set(rs.map((r) => r.player_id));
      lines.push(`No reply: ${all.filter((p) => !replied.has(p.id)).map(pname).join(', ') || '—'}`);
      for (const p of polls) {
        lines.push(`Vote "${p.question}" (${p.status}) id=${p.id}:`);
        for (const o of opts.filter((x) => x.poll_id === p.id)) {
          const v = votes.filter((x) => x.option_id === o.id);
          const c = (r: string) => v.filter((x) => x.response === r).length;
          lines.push(`  - ${o.label}${o.start_date ? ` [${o.start_date}–${o.end_date}]` : ''}: ✓${c('yes')} ?${c('maybe')} ✗${c('no')}${p.winner_option_id === o.id ? ' ← WINNER' : ''}`);
        }
      }
      const jobs = items.filter((i) => i.kind === 'job');
      lines.push(`Jobs: ${jobs.map((j) => `${j.done ? '✓' : '○'} ${j.title}${j.owner_id ? ` (${nm(j.owner_id)})` : ' (nobody)'}${j.due ? ` due ${j.due}` : ''}`).join('; ') || '—'}`);
      lines.push(`Costs: ${costs.map((c) => `${c.title} $${c.amount}${c.per_head ? ' each' : ''}${c.paid_by ? ` paid by ${nm(c.paid_by)}` : ' from kitty'}`).join('; ') || '—'} (the app's Kitty tab shows who pays who)`);
      return lines.join('\n');
    },
  },
  {
    name: 'set_rsvp',
    description: "Set whether someone is in, maybe or out for a planned trip or round (e.g. they told you in the group chat).",
    inputSchema: { type: 'object', required: ['plan_id', 'player', 'status'], properties: { plan_id: str('Plan id'), player: str('Player'), status: { type: 'string', enum: ['in', 'maybe', 'out'] }, note: str('Optional note') } },
    async run(a, c) {
      await planOf(c, a.plan_id);
      const p = findPlayer(await players(c), a.player);
      await must(db.from('plan_rsvps').upsert({ plan_id: a.plan_id, player_id: p.id, status: a.status, note: a.note || null, updated_at: new Date().toISOString() }));
      return `${pname(p)} is now "${a.status}".`;
    },
  },
  {
    name: 'add_job',
    description: 'Add a job to a planned trip or round, optionally with an owner and due date (YYYY-MM-DD).',
    inputSchema: { type: 'object', required: ['plan_id', 'title'], properties: { plan_id: str('Plan id'), title: str('The job'), owner: str('Who does it (optional)'), due: str('Due date YYYY-MM-DD (optional)'), notes: str('Optional') } },
    async run(a, c) {
      await planOf(c, a.plan_id);
      const owner = a.owner ? findPlayer(await players(c), a.owner) : null;
      await must(db.from('plan_items').insert({ plan_id: a.plan_id, kind: 'job', title: a.title, owner_id: owner?.id || null, due: a.due || null, body: a.notes || null, created_by: c.author }));
      return `Added job "${a.title}"${owner ? ` for ${pname(owner)}` : ''}.`;
    },
  },
  {
    name: 'add_cost',
    description: 'Log a shared cost on a plan: who paid and who it splits between (default everyone who is in).',
    inputSchema: { type: 'object', required: ['plan_id', 'title', 'amount'], properties: { plan_id: str('Plan id'), title: str('What for'), amount: num('Dollars'), per_head: { type: 'boolean', description: 'true = amount is per person' }, paid_by: str('Who paid (blank = from the kitty)'), split_between: { type: 'array', items: { type: 'string' }, description: 'Names (optional)' } } },
    async run(a, c) {
      await planOf(c, a.plan_id);
      const all = await players(c);
      const payer = a.paid_by ? findPlayer(all, a.paid_by) : null;
      const split = Array.isArray(a.split_between) && a.split_between.length ? [...new Set(a.split_between.map((n: string) => findPlayer(all, n).id))] : null;
      if (!(Number(a.amount) > 0)) fail('Amount must be more than $0.');
      await must(db.from('plan_costs').insert({ plan_id: a.plan_id, title: a.title, amount: Number(a.amount), per_head: !!a.per_head, paid_by: payer?.id || null, split_between: split, created_by: c.author }));
      return `Logged ${a.title} $${a.amount}${a.per_head ? ' each' : ''}${payer ? `, paid by ${pname(payer)}` : ''}${split ? `, split between ${split.length}` : ', split between everyone in'}.`;
    },
  },
  {
    name: 'create_poll',
    description: 'Put up a vote on a plan (dates, location or anything). Dates options need start_date/end_date (YYYY-MM-DD).',
    inputSchema: {
      type: 'object', required: ['plan_id', 'kind', 'question', 'options'],
      properties: {
        plan_id: str('Plan id'), kind: { type: 'string', enum: ['dates', 'location', 'other'] }, question: str('Question'), closes_on: str('YYYY-MM-DD (optional)'),
        options: { type: 'array', items: { type: 'object', properties: { label: str('Label (location/other)'), start_date: str('YYYY-MM-DD'), end_date: str('YYYY-MM-DD'), notes: str('Optional'), cost_pp: num('Rough cost per head (optional)') } } },
      },
    },
    async run(a, c) {
      await planOf(c, a.plan_id);
      const poll = await must(db.from('plan_polls').insert({ plan_id: a.plan_id, kind: a.kind, question: a.question, closes_on: a.closes_on || null, created_by: c.author }).select().single()) as Record<string, any>;
      const opts = (a.options || []).map((o: Record<string, any>) => ({ poll_id: poll.id, label: o.label || (o.start_date ? `${o.start_date}${o.end_date && o.end_date !== o.start_date ? ` – ${o.end_date}` : ''}` : 'Option'), start_date: o.start_date || null, end_date: o.end_date || o.start_date || null, notes: o.notes || null, cost_pp: o.cost_pp ?? null, created_by: c.author }));
      if (opts.length) await must(db.from('plan_options').insert(opts));
      await post(c, `🗳️ New vote: ${a.question} — have your say in Trips.`);
      return `Vote "${a.question}" is up with ${opts.length} options (id=${poll.id}) and posted to the feed. Push notifications go out when an organiser opens votes from the app.`;
    },
  },
  // ---------- Trip finder (Stage 16): the organiser's own assistant researches for free; facts it finds stay pending ----------
  {
    name: 'find_courses',
    description: "Trip finder: the courses that suit a planned trip, ranked, each with why (tee-time window, longest drive, price, rating). Uses the trip's starting areas (set in the app: Trips → the trip → Find a course). Drive times are estimates (straight line × 1.3 at 80 km/h). Courses marked CHECK have unknown facts — research them (club website, booking page) and save what you find with propose_course_fact.",
    inputSchema: {
      type: 'object', required: ['trip_id'],
      properties: {
        trip_id: str('Plan id (a planned trip or round) from lgc_overview'),
        preset: { type: 'string', enum: ['fair', 'cheap', 'best'], description: 'Ranking: fair drive (default), cheapest, or best course' },
        limit: num('How many to list (default 10, up to 30)'),
      },
    },
    async run(a, c) {
      let pl: Record<string, any> | null = null;
      const { data: byPlan } = await db.from('plans').select('*').eq('id', a.trip_id).eq('group_id', c.g).maybeSingle();
      pl = byPlan as Record<string, any> | null;
      if (!pl) {
        const { data: byTrip } = await db.from('plans').select('*').eq('trip_id', a.trip_id).eq('group_id', c.g).limit(1);
        pl = (byTrip as Record<string, any>[] | null)?.[0] || fail('No such trip in this group — check the id with lgc_overview.');
      }
      const [{ data: sp }, { data: find }] = await Promise.all([
        db.from('trip_start_points').select('*').eq('plan_id', pl!.id).order('sort'),
        db.from('trip_finds').select('*').eq('plan_id', pl!.id).maybeSingle(),
      ]);
      const starts = ((sp || []) as Record<string, any>[]).map((r) => ({ label: r.label, lat: r.lat, lng: r.lng, count: r.headcount, leave: r.leave_after, finish: r.finish_by }));
      if (!starts.length) fail('No starting areas on this trip yet — the organiser adds them in the app (Trips → the trip → Find a course), e.g. "Inner West ×8, Newcastle ×2".');
      const f = (find || {}) as Record<string, any>;
      const maxDrive = f.max_drive_min || 180;
      const box = searchBox(starts, maxDrive)!;
      const rows = await must(db.rpc('trip_finder_courses', { p_south: box.south, p_west: box.west, p_north: box.north, p_east: box.east, p_lat: box.lat, p_lng: box.lng, p_limit: 300, p_group: c.g })) as Record<string, any>[];
      const players = f.players ?? starts.reduce((n, x) => n + x.count, 0);
      const day = f.day || defaultDay(pl);
      const ranked = findCourses(rows || [], { starts, players, holes: f.holes || 18, day, maxDriveMin: maxDrive, now: new Date() }, a.preset || f.preset || 'fair', f.filters || {});
      const n = Math.max(1, Math.min(30, Number(a.limit) || 10));
      const word: Record<string, string> = { fits: 'FITS', check: 'CHECK', no: "DOESN'T FIT" };
      const lines = [`${pl!.name} · ${day} · ${players} players · ${f.holes || 18} holes · coming from ${startsText(starts)} · longest drive up to about ${Math.round(maxDrive / 6) / 10} h`];
      ranked.slice(0, n).forEach((r: any, i: number) => lines.push(`${i + 1}. ${r.course.name}${r.course.area ? ` (${r.course.area})` : ''} [${word[r.status]}] course_id=${r.course.id} — ${r.why}`));
      if (!ranked.length) lines.push('No courses in reach — try a longer drive in the app.');
      lines.push('Put options to the group from the app (Find a course → tick up to 3 → Put to the group).');
      return lines.join('\n');
    },
  },
  {
    name: 'get_course_facts',
    description: "What's known about a course (shared by every group): visitor times, members-only times, largest group, prices, booking ahead, start interval, carts, stay and play — with where each fact came from and when it was checked (never who). Plus this group's own private notes on it.",
    inputSchema: { type: 'object', required: ['course_id'], properties: { course_id: str('course_id from find_courses') } },
    async run(a, c) {
      const rows = await must(db.rpc('course_facts_for', { p_course: a.course_id })) as Record<string, any>[];
      const best = pickFacts(rows || [], new Date()) as Record<string, any>;
      const lines = FACTS.map((d: { key: string; label: string }) => `${d.label}: ${best[d.key] ? factLine(best[d.key]) : 'not known yet'}${best[d.key]?.source_link ? ` (${best[d.key].source_link})` : ''}`);
      const { data: notes } = await db.from('course_notes').select('body').eq('group_id', c.g).eq('course_id', a.course_id).order('created_at', { ascending: false }).limit(10);
      if (notes?.length) lines.push(`Your group's notes: ${(notes as { body: string }[]).map((x) => `"${x.body}"`).join('; ')}`);
      return lines.join('\n');
    },
  },
  {
    name: 'propose_course_fact',
    description: 'Save a fact you found about a course (from the club website, booking page or an email). It is saved as PENDING ("not confirmed yet") until the club or the app team confirms it. Facts: visitor_times and member_times like "Sat 7:00-12:00; Sun 9:00-13:00"; max_group, start_interval, round_length (minutes) as numbers; price_18 / price_9 as dollars each; book_ahead, carts as short text; stay_play as "Yes — …" or "No". Always include the source link if there is one.',
    inputSchema: {
      type: 'object', required: ['course_id', 'fact', 'value'],
      properties: {
        course_id: str('course_id from find_courses'),
        fact: { type: 'string', enum: FACTS.map((d: { key: string }) => d.key) },
        value: str('The fact, short (up to 200 characters)'),
        source_link: str('Where it came from (https://…), if any'),
        checked_on: str('YYYY-MM-DD the source says or was read (default today)'),
      },
    },
    async run(a, c) {
      await must(db.rpc('propose_course_fact', { p_course: a.course_id, p_fact: a.fact, p_value: String(a.value ?? ''), p_source: 'research', p_link: a.source_link || null, p_checked: a.checked_on || null, p_group: c.g }));
      return `Saved as pending: ${a.fact} = ${a.value}. It shows as "not confirmed yet" for every group until it's checked.`;
    },
  },
  {
    name: 'list_rules',
    description: 'The Rulebook: rules in force and rules up for a vote.',
    inputSchema: { type: 'object', properties: {} },
    async run(_a, c) {
      const rules = await must(db.from('rules').select('*').eq('group_id', c.g).in('status', ['active', 'proposed']).order('sort')) as Record<string, any>[];
      return rules.map((r) => `${r.status === 'proposed' ? '[up for a vote] ' : ''}${r.title}${r.value ? ` (${r.value})` : ''} — applies to ${r.applies_to.join(', ')}${r.detail ? `: ${r.detail}` : ''}`).join('\n') || 'No rules yet.';
    },
  },
  // ---------- the Tribunal (Stage 11b, migration 061). Assistants raise cases and read verdicts; they never vote,
  // decide or approve (the database refuses the service role those functions, and there's no tool for them).
  {
    name: 'raise_case',
    description: "Raise a case with the group's Tribunal. kind: 'other' (anything else, e.g. a silly charge about a player, optional penalty in words), 'ruling' (a question about a rule), 'change_rule' / 'scrap_rule' (challenge a rule in force), or 'new_rule'. The group's own decision rules decide it — you can't vote. Keep it friendly: roast the golf and the mates, never who someone is. Handicap cases go through the app.",
    inputSchema: {
      type: 'object', required: ['kind', 'title'],
      properties: {
        kind: { type: 'string', enum: ['other', 'ruling', 'change_rule', 'scrap_rule', 'new_rule'] },
        title: str('The charge, question or rule (3–140 characters)'), body: str('The case (optional)'),
        about: str('Player it is about (name; optional)'), rule: str('Rule title (for ruling / change_rule / scrap_rule)'),
        new_title: str('change_rule / new_rule: what the rule should say'), new_value: str('Worth / amount (optional)'), new_detail: str('Details (optional)'),
        answer: str('ruling: suggested ruling (optional)'), penalty: str('other: penalty in words if guilty (optional) — never money'),
      },
    },
    async run(a, c) {
      const subject = a.about ? findPlayer(await players(c), a.about) : null;
      let ruleId: string | null = null;
      if (['ruling', 'change_rule', 'scrap_rule'].includes(a.kind)) {
        const rules = await must(db.from('rules').select('id,title').eq('group_id', c.g).eq('status', 'active')) as { id: string; title: string }[];
        const w = String(a.rule || '').trim().toLowerCase();
        const hit = rules.filter((r) => r.id === a.rule || r.title.toLowerCase() === w || (w && r.title.toLowerCase().includes(w)));
        if (hit.length !== 1) fail(hit.length ? `"${a.rule}" matches ${hit.map((r) => r.title).join(' and ')} — be more specific.` : `No rule in force called "${a.rule}". Use list_rules.`);
        ruleId = hit[0].id;
      }
      const proposal = a.kind === 'change_rule' ? { title: a.new_title || '', value: a.new_value || '', detail: a.new_detail || '' }
        : a.kind === 'new_rule' ? { detail: a.new_detail || a.body || '', value: a.new_value || '' }
          : a.kind === 'ruling' ? { answer: a.answer || null } : {};
      const id = await must(db.rpc('connector_raise_case', {
        p_group: c.g, p_author: c.author, p_kind: a.kind, p_title: a.kind === 'new_rule' ? (a.new_title || a.title) : a.title,
        p_body: a.kind === 'new_rule' ? null : a.body || null, p_subject: subject?.id || null, p_rule: ruleId, p_proposal: proposal,
        p_penalty: a.kind === 'other' ? a.penalty || null : null,
      }));
      return `Case raised (id=${id}). The group decides it by its own rules in the app's Tribunal — read_verdict tells you how it went.`;
    },
  },
  {
    name: 'list_cases',
    description: "The Tribunal's open cases and recent verdicts (handicap cases too).",
    inputSchema: { type: 'object', properties: {} },
    async run(_a, c) {
      const all = await players(c);
      const [cs, hc] = await Promise.all([
        must(db.from('cases').select('id,kind,title,status,stage,subject_id,votes_for,votes_against,closes_at,created_at').eq('group_id', c.g).eq('hidden', false).order('created_at', { ascending: false }).limit(20)),
        must(db.from('tribunal_cases').select('id,accused_id,proposed_change,status,verdict,guilty_votes,not_guilty_votes,created_at').eq('group_id', c.g).order('created_at', { ascending: false }).limit(10)),
      ]) as [Record<string, any>[], Record<string, any>[]];
      const who = (id: string) => pname(all.find((p) => p.id === id));
      const lines = [
        ...cs.map((x) => `[${x.status}] ${x.kind}: ${x.title}${x.subject_id ? ` (about ${who(x.subject_id)})` : ''}${x.status === 'open' ? (x.stage === 'voting' ? ` — voting closes ${String(x.closes_at).slice(0, 16).replace('T', ' ')}` : ' — with the organisers') : ` — ${x.votes_for ?? 0}–${x.votes_against ?? 0}`} (id=${x.id})`),
        ...hc.map((x) => `[${x.status}] handicap: The Lads v ${who(x.accused_id)} (proposed ${x.proposed_change > 0 ? '+' : ''}${x.proposed_change})${x.verdict ? ` — ${x.verdict === 'upheld' ? 'GUILTY' : 'NOT GUILTY'} ${x.guilty_votes}–${x.not_guilty_votes}` : ''}`),
      ];
      return lines.join('\n') || 'No cases yet.';
    },
  },
  {
    name: 'read_verdict',
    description: 'Read one case: where it stands, the verdict, any penalty (in words) and whether a change waits for the next trip. Pass the id from list_cases or raise_case.',
    inputSchema: { type: 'object', required: ['case_id'], properties: { case_id: str('Case id') } },
    async run(a, c) {
      const x = await must(db.from('cases').select('*').eq('id', a.case_id).eq('group_id', c.g).eq('hidden', false).maybeSingle()) as Record<string, any> | null;
      if (!x) return fail('No such case in this group — check the id with list_cases.');
      const all = await players(c);
      const subject = x.subject_id ? pname(all.find((p) => p.id === x.subject_id)) : null;
      if (x.status === 'open') return `${x.title}: still being heard (${x.stage === 'voting' ? `voting closes ${String(x.closes_at).slice(0, 16).replace('T', ' ')}` : 'an organiser decides'}).`;
      const word = x.kind === 'other' ? (x.status === 'passed' ? 'GUILTY' : 'NOT GUILTY') : x.status === 'passed' ? 'Passed' : x.status === 'failed' ? 'Failed' : 'Withdrawn';
      const wait = x.apply_state === 'waiting_next_trip' ? ' It takes effect from the next trip.' : x.apply_state === 'next_round' ? ' Approved mid-trip: it starts from the next round.' : '';
      return `${x.title}${subject ? ` (about ${subject})` : ''}: ${word} ${x.votes_for ?? 0}–${x.votes_against ?? 0}. ${x.reason || ''}${x.verdict ? ` Verdict: ${x.verdict}.` : ''}${x.status === 'passed' && x.penalty ? ` Penalty: ${x.penalty}.` : ''}${wait}`;
    },
  },
  {
    name: 'suggest_feature',
    description: "Call this when the organiser asks for something that none of the other tools can do (for example: \"remind everyone who hasn't paid\" or \"book us a tee time\"). Describe the job in ONE short plain line — what they wanted done, not who it was for. Never include names, nicknames, phone numbers, emails, amounts owed or any other personal details. Don't call it for things another tool already does. Afterwards, tell the organiser it's been passed on and help them as best you can with the tools there are.",
    inputSchema: { type: 'object', required: ['job'], properties: { job: str('The job in one plain line, 3–200 characters, no names or personal details, e.g. "Remind players who haven\'t paid the kitty"') } },
    async run(a, c) {
      const job = cleanJob(a.job);
      if (job.length < 3) fail('Describe the job in a few words (no names).');
      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await db.from('feature_wishes').select('id', { count: 'exact', head: true }).eq('group_id', c.g).gte('created_at', since);
      if ((count ?? 0) < WISHES_PER_DAY) await must(db.from('feature_wishes').insert({ group_id: c.g, job, source: 'connector' }));
      return "Noted — thanks. That's passed on to the people who build The Golf Trip; the most-asked-for jobs get built first.";
    },
  },
];

// ---------- MCP over HTTP ----------
async function handle(msg: Record<string, any>, c: Ctx) {
  const { id, method, params } = msg;
  if (id === undefined) return null; // a notification — nothing to answer
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize': {
      const v = VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'lgc-golf', version: '1.0.0' }, instructions: `${c.groupName} golf app (The Golf Trip). Everything here is this group only. Call lgc_overview first to get round, team and plan ids. Scores go in with enter_scores; check names against lgc_overview. If the organiser asks for something no tool can do, call suggest_feature with a one-line description of the job (no names or personal details).` });
    }
    case 'ping': return ok({});
    case 'tools/list': {
      const offered = [];
      for (const t of TOOLS) if (!TOOL_FEATURE[t.name] || await featureOn(c, TOOL_FEATURE[t.name])) offered.push(t);
      return ok({ tools: offered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    }
    case 'tools/call': {
      const started = performance.now();
      const tool = TOOLS.find((t) => t.name === params?.name);
      // Only our own tool names are logged — an unknown name could be anything the assistant typed.
      if (!tool) { logCall(c, 'unknown', false, started, 'unknown_tool'); return err(-32602, `Unknown tool ${params?.name}`); }
      if (TOOL_FEATURE[tool.name] && !(await featureOn(c, TOOL_FEATURE[tool.name]))) {
        logCall(c, tool.name, false, started, 'switched_off');
        return ok({ content: [{ type: 'text', text: `That's switched off for ${c.groupName} (Group & invites → Features).` }], isError: true });
      }
      try {
        const text = await tool.run(params?.arguments || {}, c);
        logCall(c, tool.name, true, started);
        return ok({ content: [{ type: 'text', text }] });
      } catch (e) {
        logCall(c, tool.name, false, started, errorKind(e));
        return ok({ content: [{ type: 'text', text: String((e as Error)?.message || e) }], isError: true });
      }
    }
    default: return err(-32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  const key = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  const c = await ctxForKey(key);
  if (!c) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  if (req.method === 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers });
  let body: unknown;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), { status: 400, headers }); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, c)))).filter(Boolean);
    return out.length ? new Response(JSON.stringify(out), { headers }) : new Response(null, { status: 202, headers });
  }
  const res = await handle(body as Record<string, any>, c);
  return res ? new Response(JSON.stringify(res), { headers }) : new Response(null, { status: 202, headers });
});
