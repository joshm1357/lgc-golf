// vote-link — records a one-tap answer from a vote email (079). verify_jwt is off: the link's token is the check
// (see logic.ts). Uses the service role, so every rule is enforced in logic.ts: one person, this email's polls only,
// open votes only, not after the link expires.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { handle, type Deps } from './logic.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-group-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const must = <T>(r: { data: T; error: unknown }) => {
  if (r.error) throw r.error;
  return r.data;
};

const deps: Deps = {
  async token(id) {
    const { data } = await db.from('vote_email_tokens').select('id,group_id,plan_id,player_id,poll_ids,secret_hash,expires_at').eq('id', id).maybeSingle();
    return data;
  },
  async polls(ids) {
    if (!ids.length) return [];
    return must(await db.from('plan_polls').select('*').in('id', ids)) || [];
  },
  async options(pollIds) {
    return must(await db.from('plan_options').select('id,poll_id,label,start_date,link').in('poll_id', pollIds).order('start_date', { nullsFirst: false }).order('created_at')) || [];
  },
  async votes(pollIds, playerId) {
    return must(await db.from('plan_votes').select('option_id,poll_id,response').in('poll_id', pollIds).eq('player_id', playerId)) || [];
  },
  async player(id) {
    const { data } = await db.from('players').select('name,nickname').eq('id', id).maybeSingle();
    return data;
  },
  async plan(id) {
    const { data } = await db.from('plans').select('id,name,group_id,rsvp_locked,status').eq('id', id).maybeSingle();
    return data;
  },
  async rsvp(planId, playerId) {
    const { data } = await db.from('plan_rsvps').select('status').eq('plan_id', planId).eq('player_id', playerId).maybeSingle();
    return data?.status || null;
  },
  async featureOn(g, key) {
    const { data, error } = await db.rpc('feature_on', { p_group: g, p_key: key });
    return error ? true : data !== false;
  },
  async saveVote(v) {
    must(await db.from('plan_votes').upsert({ ...v, via: 'email', updated_at: new Date().toISOString() }, { onConflict: 'option_id,player_id' }));
  },
  async clearOtherVotes(pollId, playerId, keep) {
    must(await db.from('plan_votes').delete().eq('poll_id', pollId).eq('player_id', playerId).neq('option_id', keep));
  },
  async saveRsvp(r) {
    must(await db.from('plan_rsvps').upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'plan_id,player_id' }));
  },
  async stopEmails(t) {
    // On the app: switch their own choice to "In the app". Not on the app: wipe the address an organiser typed in.
    const { data: m } = await db.from('group_members').select('user_id').eq('group_id', t.group_id).eq('player_id', t.player_id).maybeSingle();
    if (m?.user_id) {
      must(await db.from('notify_prefs').upsert({ group_id: t.group_id, user_id: m.user_id, vote_channel: 'app', updated_at: new Date().toISOString() }, { onConflict: 'group_id,user_id' }));
    } else {
      must(await db.from('vote_emails').update({ email: null }).eq('group_id', t.group_id).eq('player_id', t.player_id));
    }
  },
  now: () => Date.now(),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'Open the link from your email.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const r = await handle(body, deps);
    return json(r.body, r.status);
  } catch (e) {
    console.error('vote-link', String((e as Error)?.message || e));
    return json({ ok: false, error: 'Something went wrong — try again, or open the vote in the app.' }, 500);
  }
});
