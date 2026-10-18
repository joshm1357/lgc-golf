// lgc-mcp — the Claude connector: lets a Claude chat run ONE group's app through a short list of
// safe actions (read the leaderboard, enter a card, confirm a comp winner, post to the feed,
// organise a trip) instead of having full database access.
//
// Connect it in Claude: Settings → Connectors → Add custom connector → paste the secret link
// https://<project>.supabase.co/functions/v1/lgc-mcp/<key>. Each key belongs to one group
// (connector_keys, stored as a SHA-256 hash) and can only see and change that group. Anyone with
// the link acts as that group's organiser, so keep it private; delete its row to cut it off.
//
// Protocol: MCP over plain HTTP (JSON-RPC 2.0, JSON responses — no streaming needed).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

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
  const ctx = data ? { g: data.group_id as string, author: (data.player_id as string) || null, groupName: (data as any).groups?.name || 'the group' } : null;
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
  if (error) fail((error as { message?: string }).message || 'Database error');
  return data;
};
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
async function post(c: Ctx, text: string) {
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
        for (const s of subs) lines.push(`    ${s.name} (hcp ${s.handicap})${s.type === 'team' ? `: ${s.members.map(pname).join(', ')}` : ''}`);
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
    description: 'The scores for a round (default: the live round, else the latest). Gross, holes played, handicap and net (Ambrose) or Stableford points.',
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
        const pts = mine.reduce((t, x) => {
          const h = holes.find((hh) => hh.n === x.hole);
          if (!h || x.strokes == null) return t;
          return t + Math.max(0, 2 + h.par + strokesReceived(s.handicap, h.si) - x.strokes);
        }, 0);
        return { s, played: played.length, gross, toPar: gross - par, points: pts, sort: -pts };
      }).sort((x, y) => x.sort - y.sort);
      const head = `${round.name} (${round.format}, ${round.status}) at ${course.name}, par ${holes.reduce((t, h) => t + h.par, 0)}${round.comp_bonus ? `. Side comps worth −${round.comp_bonus}, already taken off the net below` : ''}`;
      return [head, ...rows.map((r, i) => `${i + 1}. ${r.s.name} — thru ${r.played} · gross ${r.gross} (${r.toPar >= 0 ? '+' : ''}${r.toPar}) · hcp ${r.s.handicap} · ${'points' in r ? `${r.points} pts` : `net ${Math.round((r.net as number) * 10) / 10}${(r as any).comps?.length ? ` (incl. ${(r as any).comps.join(', ')})` : ''}`}`)].join('\n');
    },
  },
  {
    name: 'enter_scores',
    description: 'Enter or correct hole scores for one team (Ambrose) or player (Stableford), e.g. from a photo of a scorecard. Overwrites those holes. Optionally who drove (Ambrose minimum-drives rule).',
    inputSchema: {
      type: 'object', required: ['who', 'scores'],
      properties: {
        round_id: str('Round id (optional: the live round)'),
        who: str('Team name (Ambrose) or player name (Stableford)'),
        scores: { type: 'array', items: { type: 'object', required: ['hole', 'strokes'], properties: { hole: num('1–18'), strokes: num('Strokes, 1–15; 0 = picked up (Stableford)'), drive_by: str('Ambrose: player whose tee shot was used (optional)') } } },
      },
    },
    async run(a, c) {
      const round = await currentRound(c, a.round_id);
      if (round.status === 'locked') fail(`"${round.name}" is locked. Reopen it in Admin first.`);
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
    description: 'Post a message to the group feed (as the admin).',
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
      return `Vote "${a.question}" is up with ${opts.length} options (id=${poll.id}) and posted to the feed. Push notifications go out when the admin opens votes from the app.`;
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
      return ok({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'lgc-golf', version: '1.0.0' }, instructions: `${c.groupName} golf app (The Golf Trip). Everything here is this group only. Call lgc_overview first to get round, team and plan ids. Scores go in with enter_scores; check names against lgc_overview.` });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return err(-32602, `Unknown tool ${params?.name}`);
      try {
        return ok({ content: [{ type: 'text', text: await tool.run(params?.arguments || {}, c) }] });
      } catch (e) {
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
