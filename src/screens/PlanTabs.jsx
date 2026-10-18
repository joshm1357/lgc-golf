// The Planner's other tabs: Details (where/when, day plan, info, bring list), Jobs, Kitty, Rooms & cars.
import React, { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData, useSession, playerName } from '../lib/store.jsx';
import { Avatar, Sheet, Icon, toast } from '../components/ui.jsx';
import { fmtRange, countdown, icsFor, nudgeText, mapsLink, kitty, money, DEFAULT_BRING, todayISO, daysUntil } from '../lib/plan.js';
import { REVEAL_MS } from '../lib/draw.js';
import { notify, appLink, downloadFile } from '../lib/push.js';
import { useRun, must, feedPost, everyone, shareNudge } from './Planner.jsx';

const canEdit = (item, me, isAdmin) => isAdmin || item.created_by === me || item.owner_id === me;

// ---------------------------------------------------------------- Details

export function DetailsTab({ pd }) {
  const { status } = useSession();
  const { plan } = pd;
  const [adding, setAdding] = useState(null); // 'day' | 'info' | 'bring'
  const [editing, setEditing] = useState(null);
  const [busy, run] = useRun();
  const where = plan.address || plan.location_name;
  const days = pd.items.filter((i) => i.kind === 'day');
  const info = pd.items.filter((i) => i.kind === 'info');
  const bring = pd.items.filter((i) => i.kind === 'bring');
  const byDay = useMemo(() => {
    const m = new Map();
    for (const it of [...days].sort((a, b) => String(a.day).localeCompare(String(b.day)) || timeKey(a.time) - timeKey(b.time))) {
      const k = it.day || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return [...m.entries()];
  }, [days]);
  const [ticked, setTicked] = useState(() => { try { return JSON.parse(localStorage.getItem(`lgc-bring-${plan.id}`) || '[]'); } catch { return []; } });
  const tick = (id) => {
    const next = ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id];
    setTicked(next);
    try { localStorage.setItem(`lgc-bring-${plan.id}`, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <>
      <div className="card pad stack" style={{ gap: 8 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="label">When</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{plan.start_date ? fmtRange(plan.start_date, plan.end_date) : 'To be decided'}</div>
            {plan.start_date && <div className="small muted">{countdown(plan.start_date)}</div>}
          </div>
          {plan.start_date && daysUntil(plan.start_date) >= 0 && <span className="num" style={{ fontSize: 34, lineHeight: 1 }}>{daysUntil(plan.start_date)}<span className="small muted" style={{ fontFamily: 'inherit' }}> days</span></span>}
        </div>
        <div>
          <div className="label">Where</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{plan.location_name || 'To be decided'}</div>
          {plan.address && <div className="small muted">{plan.address}</div>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {where && <a className="btn ghost sm" href={mapsLink(where)} target="_blank" rel="noreferrer">{Icon.pin(16)} Open in Maps</a>}
          {plan.link && <a className="btn ghost sm" href={plan.link} target="_blank" rel="noreferrer">Link ↗</a>}
          {plan.start_date && <button type="button" className="btn ghost sm" onClick={() => { downloadFile(`${plan.name.replace(/[^a-z0-9]+/gi, '-')}.ics`, icsFor(plan, appLink(`/plan/${plan.id}`))); toast('Open the file to add it to your calendar'); }}>📅 Add to calendar</button>}
          <button type="button" className="btn ghost sm" onClick={() => shareNudge(nudgeText('details', { plan, url: appLink(`/plan/${plan.id}?tab=details`) }))}>💬 Share</button>
        </div>
      </div>

      {plan.brief && <div className="card pad" style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.5 }}><div className="label" style={{ marginBottom: 4 }}>The details</div>{plan.brief}</div>}
      {!plan.brief && status.is_admin && <div className="small muted">Tip: tap Edit at the top to add the details — accommodation, check-in time, door code, meeting point.</div>}

      {info.map((it) => (
        <button key={it.id} type="button" className="card pad stack" style={{ gap: 4, textAlign: 'left', color: 'inherit', width: '100%' }} onClick={() => canEdit(it, status.player_id, status.is_admin) && setEditing(it)}>
          <strong style={{ fontSize: 16 }}>{it.title}</strong>
          {it.body && <div style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{it.body}</div>}
          {(it.address || it.link) && (
            <div className="row" style={{ gap: 10 }}>
              {it.address && <a href={mapsLink(it.address)} target="_blank" rel="noreferrer" className="small" onClick={(e) => e.stopPropagation()}>📍 {it.address}</a>}
              {it.link && <a href={it.link} target="_blank" rel="noreferrer" className="small" onClick={(e) => e.stopPropagation()}>Link ↗</a>}
            </div>
          )}
        </button>
      ))}

      <div className="row between"><span className="label">Day by day</span><button type="button" className="btn ghost sm" onClick={() => setAdding('day')}>+ Add</button></div>
      {byDay.length === 0 && <div className="small muted">Nothing yet — tee times, travel, dinners go here.</div>}
      {byDay.map(([day, list]) => (
        <div key={day} className="card">
          <div className="small" style={{ padding: '8px 14px', background: 'var(--navy)', color: '#fff', fontWeight: 700 }}>{day ? fmtRange(day) : 'Any day'}</div>
          {list.map((it) => (
            <button key={it.id} type="button" className="row" style={{ width: '100%', alignItems: 'flex-start', padding: '10px 14px', border: 0, borderBottom: '1px solid var(--line-soft)', background: '#fff', textAlign: 'left', color: 'inherit', gap: 12 }}
              onClick={() => canEdit(it, status.player_id, status.is_admin) && setEditing(it)}>
              <span className="num" style={{ width: 64, flex: 'none', fontSize: 16 }}>{it.time || '—'}</span>
              <span className="grow">
                <strong>{it.title}</strong>
                {it.body && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{it.body}</div>}
                {it.address && <div><a href={mapsLink(it.address)} target="_blank" rel="noreferrer" className="small" onClick={(e) => e.stopPropagation()}>📍 {it.address}</a></div>}
              </span>
            </button>
          ))}
        </div>
      ))}

      <div className="row between"><span className="label">What to bring</span><button type="button" className="btn ghost sm" onClick={() => setAdding('bring')}>+ Add</button></div>
      {bring.length === 0 ? (
        <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => { await must(supabase.from('plan_items').insert(DEFAULT_BRING.map((t, i) => ({ plan_id: plan.id, kind: 'bring', title: t, sort: i })))); pd.reload(); }, 'Added the usual list')}>+ Start from the usual list</button>
      ) : (
        <div className="card">
          {bring.map((it) => (
            <div key={it.id} className="row" style={{ padding: '6px 14px', borderBottom: '1px solid var(--line-soft)' }}>
              <label className="row grow" style={{ gap: 10, minHeight: 40 }}>
                <input type="checkbox" checked={ticked.includes(it.id)} onChange={() => tick(it.id)} style={{ width: 22, height: 22 }} />
                <span style={{ textDecoration: ticked.includes(it.id) ? 'line-through' : 'none', color: ticked.includes(it.id) ? 'var(--muted)' : 'inherit' }}>{it.title}</span>
              </label>
              {(status.is_admin || it.created_by === status.player_id) && <button type="button" className="btn ghost sm" aria-label={`Remove ${it.title}`} onClick={() => run(async () => { await must(supabase.from('plan_items').delete().eq('id', it.id)); pd.reload(); })}>{Icon.x(14)}</button>}
            </div>
          ))}
          <div className="small muted" style={{ padding: '6px 14px' }}>Ticks are just for you, on this phone.</div>
        </div>
      )}
      <button type="button" className="btn ghost block" onClick={() => setAdding('info')}>+ Add info (accommodation, parking, door code…)</button>

      {(adding || editing) && <ItemSheet plan={plan} kind={editing?.kind || adding} item={editing} onClose={() => { setAdding(null); setEditing(null); }} onSaved={pd.reload} />}
    </>
  );
}

function timeKey(t) {
  const m = String(t || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/);
  if (!m) return 9999;
  let h = Number(m[1]) % 24;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h * 60 + Number(m[2] || 0);
}

const ITEM_TITLE = { day: 'Day plan', info: 'Info', job: 'Job', bring: 'Bring' };

/** Add or edit one item of any kind. */
export function ItemSheet({ plan, kind, item, onClose, onSaved }) {
  const data = useData();
  const { status } = useSession();
  const [v, set] = useState(() => item || { day: plan.start_date || '', owner_id: kind === 'job' ? '' : null });
  const [busy, run] = useRun();
  const f = (k) => ({ value: v[k] ?? '', onChange: (e) => set({ ...v, [k]: e.target.value }) });
  const save = () => run(async () => {
    const row = {
      plan_id: plan.id, kind, title: (v.title || '').trim(),
      day: kind === 'day' ? v.day || null : null, time: kind === 'day' ? v.time?.trim() || null : null,
      body: v.body?.trim() || null, address: v.address?.trim() || null, link: v.link?.trim() || null,
      owner_id: kind === 'job' ? v.owner_id || null : null, due: kind === 'job' ? v.due || null : null,
    };
    let saved;
    if (item) saved = await must(supabase.from('plan_items').update(row).eq('id', item.id).select().single());
    else saved = await must(supabase.from('plan_items').insert(row).select().single());
    if (kind === 'job' && row.owner_id && row.owner_id !== status.player_id && row.owner_id !== item?.owner_id) await notify('job_assigned', { item_id: saved.id });
    onSaved(); onClose();
  }, item ? 'Saved' : 'Added');
  return (
    <Sheet title={`${item ? 'Edit' : 'Add'} ${ITEM_TITLE[kind].toLowerCase()}`} onClose={onClose}>
      <div className="stack">
        {kind === 'day' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
            <label className="field"><span>Day</span><input className="input" type="date" {...f('day')} min={plan.start_date || undefined} max={plan.end_date || undefined} /></label>
            <label className="field"><span>Time</span><input className="input" {...f('time')} placeholder="7:30am" /></label>
          </div>
        )}
        <label className="field"><span>{kind === 'day' ? 'What' : kind === 'info' ? 'Heading' : kind === 'job' ? 'The job' : 'Item'}</span>
          <input className="input" {...f('title')} placeholder={{ day: 'e.g. Tee off — Gerringong', info: 'e.g. Accommodation', job: 'e.g. Book tee times', bring: 'e.g. Rain jacket' }[kind]} />
        </label>
        {kind === 'job' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
            <label className="field"><span>Who’s doing it</span>
              <select className="select" {...f('owner_id')}>
                <option value="">— nobody yet —</option>
                {everyone(data).map((p) => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
              </select>
            </label>
            <label className="field"><span>Due</span><input className="input" type="date" {...f('due')} /></label>
          </div>
        )}
        {kind !== 'bring' && <label className="field"><span>Notes</span><textarea className="textarea" rows={3} style={{ padding: 12 }} {...f('body')} /></label>}
        {(kind === 'day' || kind === 'info') && <label className="field"><span>Address (opens in Maps)</span><input className="input" {...f('address')} /></label>}
        {(kind === 'info' || kind === 'job') && <label className="field"><span>Link</span><input className="input" type="url" {...f('link')} /></label>}
        {kind === 'job' && v.owner_id && v.owner_id !== status.player_id && <span className="small muted">They’ll get a notification (if they’ve turned them on).</span>}
        <button type="button" className="btn gold block" disabled={busy || !v.title?.trim()} onClick={save}>{item ? 'Save' : 'Add'}</button>
        {item && (status.is_admin || item.created_by === status.player_id) && (
          <button type="button" className="btn ghost block" onClick={() => run(async () => { await must(supabase.from('plan_items').delete().eq('id', item.id)); onSaved(); onClose(); }, 'Removed')}>Remove</button>
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Jobs

export function JobsTab({ pd }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [busy, run] = useRun();
  const jobs = pd.items.filter((i) => i.kind === 'job');
  const today = todayISO();
  const shown = jobs
    .filter((j) => (filter === 'mine' ? j.owner_id === me : filter === 'todo' ? !j.done : true))
    .sort((a, b) => Number(a.done) - Number(b.done) || String(a.due || '9999').localeCompare(String(b.due || '9999')));
  const done = jobs.filter((j) => j.done).length;
  const unowned = jobs.filter((j) => !j.owner_id && !j.done).length;

  return (
    <>
      <div className="row between">
        <span><strong>{done} of {jobs.length}</strong> <span className="small muted">done{unowned ? ` · ${unowned} with nobody on it` : ''}</span></span>
        <div className="seg light" role="group" style={{ width: 'auto' }}>
          {[['all', 'All'], ['todo', 'Open'], ['mine', 'Mine']].map(([k, l]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      {jobs.length > 0 && <div className="vote-bar"><span className="g" style={{ width: `${(done / jobs.length) * 100}%`, background: 'var(--navy)' }} /></div>}
      {shown.length === 0 && <div className="empty">{filter === 'mine' ? 'No jobs with your name on them. Lucky.' : 'No jobs yet. The organiser’s checklist above suggests the usual ones.'}</div>}
      {shown.length > 0 && (
        <div className="card">
          {shown.map((j) => {
            const owner = data.playersById[j.owner_id];
            const late = !j.done && j.due && j.due < today;
            const mayTick = canEdit(j, me, status.is_admin);
            return (
              <div key={j.id} className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-soft)', gap: 10, alignItems: 'flex-start' }}>
                <input type="checkbox" aria-label={`Done: ${j.title}`} checked={j.done} disabled={!mayTick || busy} style={{ width: 24, height: 24, marginTop: 4 }}
                  onChange={() => run(async () => { await must(supabase.from('plan_items').update({ done: !j.done }).eq('id', j.id)); pd.reload(); }, j.done ? null : 'Nice work ✓')} />
                <button type="button" className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0, color: 'inherit' }} onClick={() => mayTick && setEditing(j)}>
                  <div style={{ fontWeight: 700, textDecoration: j.done ? 'line-through' : 'none', color: j.done ? 'var(--muted)' : 'inherit' }}>{j.title}</div>
                  <div className="small" style={{ color: late ? 'var(--under)' : 'var(--muted)', fontWeight: late ? 700 : 400 }}>
                    {owner ? playerName(owner) : 'Nobody yet'}{j.due ? ` · due ${fmtRange(j.due)}${late ? ' — overdue' : ''}` : ''}
                  </div>
                  {j.body && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{j.body}</div>}
                </button>
                {owner ? <Avatar player={owner} size={30} /> : (
                  <button type="button" className="btn ghost sm" disabled={busy || !me} onClick={() => run(async () => { await must(supabase.from('plan_items').update({ owner_id: me }).eq('id', j.id)); pd.reload(); }, 'It’s yours')}>I’ll do it</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="btn gold block" onClick={() => setAdding(true)}>+ Add a job</button>
      {(adding || editing) && <ItemSheet plan={pd.plan} kind="job" item={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={pd.reload} />}
    </>
  );
}

// ---------------------------------------------------------------- Kitty

export function KittyTab({ pd }) {
  const data = useData();
  const { status } = useSession();
  const me = status.player_id;
  const [costFor, setCostFor] = useState(null); // {} = new
  const [payFor, setPayFor] = useState(null);
  const [busy, run] = useRun();
  const inIds = pd.rsvps.filter((r) => r.status === 'in').map((r) => r.player_id);
  const k = kitty(pd.costs, pd.payments, inIds);
  const mine = k.people.find((p) => p.player_id === me);
  const owing = k.people.filter((p) => p.balance > 0.5);
  const label = (b) => (b > 0.5 ? { t: `owes ${money(b)}`, c: 'var(--under)' } : b < -0.5 ? { t: `owed ${money(-b)}`, c: '#1F7A4D' } : { t: 'square ✓', c: 'var(--navy)' });

  return (
    <>
      {inIds.length === 0 && <div className="small muted">Shares are split between everyone who’s <strong>In</strong> — nobody’s in yet.</div>}
      {mine && (
        <div className="card pad" style={{ background: mine.balance > 0.5 ? '#FFF1EE' : 'var(--gold-soft)', borderColor: mine.balance > 0.5 ? 'var(--under)' : 'var(--gold)' }}>
          <div className="label">You</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: label(mine.balance).c }}>{label(mine.balance).t}</div>
          <div className="small muted">Your share {money(mine.share)} · paid in {money(mine.paid)}{mine.fronted ? ` · fronted ${money(mine.fronted)}` : ''}</div>
        </div>
      )}
      {pd.plan.kitty_note && <div className="card pad"><div className="label">How to pay</div><div style={{ fontSize: 16, fontWeight: 600 }}>{pd.plan.kitty_note}</div></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
        {[['Total', money(k.total)], [`Each (${inIds.length})`, money(k.perHead)], ['In the kitty', money(k.pot)]].map(([l, v]) => (
          <div key={l} className="card pad"><div className="num" style={{ fontSize: 22 }}>{v}</div><div className="small muted">{l}</div></div>
        ))}
      </div>

      <div className="row between"><span className="label">Costs</span>{status.is_admin && <button type="button" className="btn ghost sm" onClick={() => setCostFor({})}>+ Add a cost</button>}</div>
      {pd.costs.length === 0 ? <div className="small muted">No costs yet.{status.is_admin ? ' Add the house, green fees, the big dinner…' : ''}</div> : (
        <div className="card">
          {pd.costs.map((c) => (
            <button key={c.id} type="button" disabled={!status.is_admin} className="row between" onClick={() => setCostFor(c)}
              style={{ width: '100%', padding: '10px 14px', border: 0, borderBottom: '1px solid var(--line-soft)', background: '#fff', textAlign: 'left', color: 'inherit' }}>
              <span><strong>{c.title}</strong><div className="small muted">{c.paid_by ? `Fronted by ${playerName(data.playersById[c.paid_by])}` : 'Paid from the kitty'}</div></span>
              <span className="num" style={{ fontSize: 18 }}>{money(c.amount)}{c.per_head && <span className="small muted" style={{ fontFamily: 'inherit' }}> pp</span>}</span>
            </button>
          ))}
        </div>
      )}

      <span className="label">Everyone</span>
      {k.people.length > 0 && (
        <div className="card">
          {[...k.people].sort((a, b) => b.balance - a.balance).map((p) => {
            const pl = data.playersById[p.player_id];
            const l = label(p.balance);
            return (
              <button key={p.player_id} type="button" disabled={!status.is_admin} className="row" onClick={() => setPayFor(p)}
                style={{ width: '100%', padding: '8px 14px', border: 0, borderBottom: '1px solid var(--line-soft)', background: '#fff', textAlign: 'left', color: 'inherit' }}>
                <Avatar player={pl} size={30} />
                <span className="grow"><strong>{playerName(pl)}</strong><div className="small muted">paid {money(p.paid)}{p.fronted ? ` · fronted ${money(p.fronted)}` : ''}</div></span>
                <span style={{ fontWeight: 800, color: l.c }}>{l.t}</span>
              </button>
            );
          })}
        </div>
      )}
      {status.is_admin && <span className="small muted">Tap someone to record what they’ve paid in. “Fronted” = they paid a cost for the group, so it comes off their share.</span>}
      {owing.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn ghost sm" onClick={() => shareNudge(nudgeText('kitty', { plan: pd.plan, names: owing.map((p) => playerName(data.playersById[p.player_id])), url: appLink(`/plan/${pd.plan.id}?tab=kitty`), extra: pd.plan.kitty_note || '' }))}>💬 Nudge in Messenger</button>
          {status.is_admin && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { const r = await notify('nudge_kitty', { plan_id: pd.plan.id }); toast(`Reminder sent to ${r.sent || 0} phone${r.sent === 1 ? '' : 's'}`); })}>🔔 Remind who owes</button>}
        </div>
      )}
      {costFor && <CostSheet pd={pd} cost={costFor.id ? costFor : null} onClose={() => setCostFor(null)} />}
      {payFor && <PaySheet pd={pd} person={payFor} onClose={() => setPayFor(null)} />}
    </>
  );
}

function CostSheet({ pd, cost, onClose }) {
  const data = useData();
  const [v, set] = useState(() => cost || { per_head: false, paid_by: '' });
  const [busy, run] = useRun();
  const amount = Number(String(v.amount ?? '').replace(/[^0-9.]/g, ''));
  return (
    <Sheet title={cost ? 'Edit cost' : 'Add a cost'} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>What</span><input className="input" value={v.title || ''} onChange={(e) => set({ ...v, title: e.target.value })} placeholder="e.g. The house" /></label>
        <label className="field"><span>Amount $</span><input className="input" inputMode="decimal" value={v.amount ?? ''} onChange={(e) => set({ ...v, amount: e.target.value })} /></label>
        <div className="seg light" role="group">
          <button type="button" aria-pressed={!v.per_head} onClick={() => set({ ...v, per_head: false })}>Total — split it</button>
          <button type="button" aria-pressed={!!v.per_head} onClick={() => set({ ...v, per_head: true })}>Per person</button>
        </div>
        <label className="field"><span>Who paid it</span>
          <select className="select" value={v.paid_by || ''} onChange={(e) => set({ ...v, paid_by: e.target.value })}>
            <option value="">From the kitty / not paid yet</option>
            {everyone(data).map((p) => <option key={p.id} value={p.id}>{playerName(p)} fronted it</option>)}
          </select>
        </label>
        <button type="button" className="btn gold block" disabled={busy || !v.title?.trim() || !(amount >= 0) || v.amount === '' || v.amount == null} onClick={() => run(async () => {
          const row = { plan_id: pd.plan.id, title: v.title.trim(), amount, per_head: !!v.per_head, paid_by: v.paid_by || null };
          if (cost) await must(supabase.from('plan_costs').update(row).eq('id', cost.id));
          else await must(supabase.from('plan_costs').insert(row));
          pd.reload(); onClose();
        }, 'Saved')}>Save</button>
        {cost && <button type="button" className="btn ghost block" onClick={() => run(async () => { await must(supabase.from('plan_costs').delete().eq('id', cost.id)); pd.reload(); onClose(); }, 'Removed')}>Remove</button>}
      </div>
    </Sheet>
  );
}

function PaySheet({ pd, person, onClose }) {
  const data = useData();
  const [paid, setPaid] = useState(String(person.paid || ''));
  const [busy, run] = useRun();
  const save = (value) => run(async () => {
    await must(supabase.from('plan_payments').upsert({ plan_id: pd.plan.id, player_id: person.player_id, paid: Number(String(value).replace(/[^0-9.]/g, '')) || 0, updated_at: new Date().toISOString() }));
    pd.reload(); onClose();
  }, 'Saved');
  return (
    <Sheet title={playerName(data.playersById[person.player_id])} onClose={onClose}>
      <div className="stack">
        <div className="small">Share {money(person.share)}{person.fronted ? ` · fronted ${money(person.fronted)}` : ''} · currently {person.balance > 0.5 ? `owes ${money(person.balance)}` : 'square'}</div>
        <label className="field"><span>Total they’ve paid into the kitty $</span><input className="input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
        <button type="button" className="btn gold block" disabled={busy} onClick={() => save(paid)}>Save</button>
        {person.balance > 0.5 && <button type="button" className="btn ghost block" disabled={busy} onClick={() => save(Number(person.paid) + person.balance)}>Mark as fully paid ({money(Number(person.paid) + person.balance)})</button>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Rooms & cars

export function GroupsTab({ pd }) {
  const data = useData();
  const { status } = useSession();
  const [kind, setKind] = useState(pd.plan.kind === 'round' ? 'car' : 'room');
  const [editing, setEditing] = useState(null); // {} new
  const [assigning, setAssigning] = useState(null);
  const [drawing, setDrawing] = useState(false);
  const groups = pd.groups.filter((g) => g.kind === kind);
  const ids = new Set(groups.map((g) => g.id));
  const members = pd.members.filter((m) => ids.has(m.group_id));
  const inIds = pd.rsvps.filter((r) => r.status === 'in').map((r) => r.player_id);
  const placed = new Set(members.map((m) => m.player_id));
  const unplaced = inIds.filter((id) => !placed.has(id));
  const word = kind === 'car' ? { one: 'car', many: 'cars', seat: 'seats' } : { one: 'room', many: 'rooms', seat: 'beds' };
  const capacity = groups.reduce((s, g) => s + g.capacity, 0);

  return (
    <>
      {pd.plan.kind === 'trip' && (
        <div className="seg light" role="group">
          <button type="button" aria-pressed={kind === 'room'} onClick={() => setKind('room')}>🛏️ Rooms</button>
          <button type="button" aria-pressed={kind === 'car'} onClick={() => setKind('car')}>🚗 Cars</button>
        </div>
      )}
      {groups.length === 0 && <div className="empty">No {word.many} yet.{status.is_admin ? ` Add the ${word.many} and how many ${word.seat} each, then draw them live or place people by hand.` : ''}</div>}
      {groups.map((g) => {
        const ms = members.filter((m) => m.group_id === g.id).map((m) => data.playersById[m.player_id]).filter(Boolean);
        return (
          <button key={g.id} type="button" className="card pad stack" disabled={!status.is_admin} onClick={() => setAssigning(g)} style={{ gap: 6, textAlign: 'left', color: 'inherit', width: '100%' }}>
            <div className="row between"><strong style={{ fontSize: 17 }}>{g.name}</strong><span className="small muted">{ms.length}/{g.capacity} {word.seat}</span></div>
            {g.note && <div className="small muted">{g.note}</div>}
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {ms.map((p) => <span key={p.id} className="row" style={{ gap: 6 }}><Avatar player={p} size={28} /><span style={{ fontWeight: 600 }}>{playerName(p)}</span></span>)}
              {Array.from({ length: Math.max(0, g.capacity - ms.length) }).map((_, i) => <span key={i} style={{ width: 28, height: 28, borderRadius: '50%', border: '2px dashed #B9C2CC', display: 'inline-block' }} />)}
            </div>
          </button>
        );
      })}
      {unplaced.length > 0 && groups.length > 0 && (
        <div className="small"><strong>Not placed yet ({unplaced.length}):</strong> <span className="muted">{unplaced.map((id) => playerName(data.playersById[id])).join(', ')}</span></div>
      )}
      {groups.length > 0 && capacity < inIds.length && <div className="err">{inIds.length} in but only {capacity} {word.seat} — add another {word.one}.</div>}
      {status.is_admin && (
        <div className="stack" style={{ gap: 8 }}>
          <button type="button" className="btn ghost block" onClick={() => setEditing({})}>+ Add a {word.one}</button>
          {groups.length > 0 && inIds.length > 0 && <button type="button" className="btn gold block" style={{ minHeight: 56 }} onClick={() => setDrawing(true)}>🎲 Draw the {word.many} live</button>}
          {groups.length > 0 && <span className="small muted">Tap a {word.one} to put people in by hand, rename it or remove it.</span>}
        </div>
      )}
      {editing && <GroupSheet pd={pd} kind={kind} group={editing.id ? editing : null} onClose={() => setEditing(null)} />}
      {assigning && <AssignSheet pd={pd} group={assigning} groups={groups} members={members} inIds={inIds} onEdit={() => { setEditing(assigning); setAssigning(null); }} onClose={() => setAssigning(null)} />}
      {drawing && <GroupDrawSheet pd={pd} kind={kind} groups={groups} members={members} inIds={inIds} onClose={() => setDrawing(false)} />}
    </>
  );
}

function GroupSheet({ pd, kind, group, onClose }) {
  const [v, set] = useState(() => group || { name: `${kind === 'car' ? 'Car' : 'Room'} ${pd.groups.filter((g) => g.kind === kind).length + 1}`, capacity: kind === 'car' ? 4 : 2 });
  const [busy, run] = useRun();
  return (
    <Sheet title={group ? `Edit ${group.name}` : `Add a ${kind === 'car' ? 'car' : 'room'}`} onClose={onClose}>
      <div className="stack">
        <label className="field"><span>Name</span><input className="input" value={v.name || ''} onChange={(e) => set({ ...v, name: e.target.value })} placeholder={kind === 'car' ? 'e.g. Josh’s Outback' : 'e.g. Bunk room'} /></label>
        <label className="field"><span>{kind === 'car' ? 'Seats (passengers incl. driver)' : 'Beds'}</span><input className="input" type="number" min={1} max={12} value={v.capacity} onChange={(e) => set({ ...v, capacity: e.target.value })} /></label>
        <label className="field"><span>Note (optional)</span><input className="input" value={v.note || ''} onChange={(e) => set({ ...v, note: e.target.value })} placeholder={kind === 'car' ? 'e.g. leaves Leichhardt 6am' : 'e.g. queen + single'} /></label>
        <button type="button" className="btn gold block" disabled={busy || !v.name?.trim()} onClick={() => run(async () => {
          const row = { plan_id: pd.plan.id, kind, name: v.name.trim(), capacity: Math.max(1, Math.min(12, Number(v.capacity) || 1)), note: v.note?.trim() || null };
          if (group) await must(supabase.from('plan_groups').update(row).eq('id', group.id));
          else await must(supabase.from('plan_groups').insert(row));
          pd.reload(); onClose();
        }, 'Saved')}>Save</button>
        {group && <button type="button" className="btn ghost block" onClick={() => { if (window.confirm(`Remove ${group.name}?`)) run(async () => { await must(supabase.from('plan_groups').delete().eq('id', group.id)); pd.reload(); onClose(); }, 'Removed'); }}>Remove</button>}
      </div>
    </Sheet>
  );
}

function AssignSheet({ pd, group, groups, members, inIds, onEdit, onClose }) {
  const data = useData();
  const [busy, run] = useRun();
  const here = new Set(members.filter((m) => m.group_id === group.id).map((m) => m.player_id));
  const whereIs = (pid) => groups.find((g) => members.some((m) => m.group_id === g.id && m.player_id === pid));
  const toggle = (pid) => run(async () => {
    if (here.has(pid)) {
      await must(supabase.from('plan_group_members').delete().eq('group_id', group.id).eq('player_id', pid));
    } else {
      if (here.size >= group.capacity) throw new Error(`${group.name} is full (${group.capacity}).`);
      const other = whereIs(pid);
      if (other) await must(supabase.from('plan_group_members').delete().eq('group_id', other.id).eq('player_id', pid));
      await must(supabase.from('plan_group_members').insert({ group_id: group.id, player_id: pid }));
    }
    pd.reload();
  });
  return (
    <Sheet title={`${group.name} · ${here.size}/${group.capacity}`} onClose={onClose}>
      <div className="stack">
        <div className="card">
          {inIds.map((pid) => {
            const p = data.playersById[pid];
            const other = !here.has(pid) && whereIs(pid);
            return (
              <button key={pid} type="button" className="row" disabled={busy} onClick={() => toggle(pid)} aria-pressed={here.has(pid)}
                style={{ width: '100%', padding: '8px 12px', border: 0, borderBottom: '1px solid var(--line-soft)', background: here.has(pid) ? 'var(--gold-soft)' : '#fff', textAlign: 'left', color: 'inherit' }}>
                <Avatar player={p} size={30} />
                <span className="grow" style={{ fontWeight: 600 }}>{playerName(p)}{other && <span className="small muted"> · in {other.name}</span>}</span>
                <span style={{ fontWeight: 800 }}>{here.has(pid) ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
        {inIds.length === 0 && <div className="small muted">Only people who are In can be placed.</div>}
        <button type="button" className="btn ghost block" onClick={onEdit}>Rename / change size / remove</button>
      </div>
    </Sheet>
  );
}

/** Open a live draw room for rooms or cars — the same lotto-style draw as the teams. */
function GroupDrawSheet({ pd, kind, groups, members, inIds, onClose }) {
  const data = useData();
  const { status } = useSession();
  const [keep, setKeep] = useState(members.length > 0);
  const [pace, setPace] = useState('click');
  const [busy, run] = useRun();
  const placed = new Set(members.map((m) => m.player_id));
  const field = keep ? inIds.filter((id) => !placed.has(id)) : inIds;
  const slots = groups.map((g) => ({ id: g.id, name: g.name, capacity: g.capacity - (keep ? members.filter((m) => m.group_id === g.id).length : 0) })).filter((g) => g.capacity > 0);
  const room = slots.reduce((s, g) => s + g.capacity, 0);
  const word = kind === 'car' ? 'cars' : 'rooms';
  return (
    <Sheet title={`Draw the ${word}`} onClose={onClose}>
      <div className="stack">
        <span className="small muted">Everyone with the app open watches it live, name by name.</span>
        {members.length > 0 && (
          <div className="seg light" role="group">
            <button type="button" aria-pressed={keep} onClick={() => setKeep(true)}>Keep who’s placed</button>
            <button type="button" aria-pressed={!keep} onClick={() => setKeep(false)}>Redraw everyone</button>
          </div>
        )}
        <div className="small"><strong>In the draw ({field.length}):</strong> {field.map((id) => playerName(data.playersById[id])).join(', ') || 'nobody'}</div>
        <div className="small"><strong>Spaces:</strong> {slots.map((g) => `${g.name} (${g.capacity})`).join(', ') || 'none'}</div>
        {field.length > room && <div className="err">{field.length} people but {room} spaces — {field.length - room} will miss out. Add a {kind === 'car' ? 'car' : 'room'} first.</div>}
        <div className="seg light" role="group">
          <button type="button" aria-pressed={pace === 'click'} onClick={() => setPace('click')}>I’ll click through</button>
          <button type="button" aria-pressed={pace === 'timed'} onClick={() => setPace('timed')}>Timed</button>
        </div>
        <button type="button" className="btn gold block" style={{ minHeight: 56 }} disabled={busy || !field.length || !slots.length} onClick={() => run(async () => {
          await supabase.from('draws').update({ status: 'cancelled' }).eq('plan_id', pd.plan.id).in('status', ['lobby', 'running', 'done']);
          await must(supabase.from('draws').insert({
            plan_id: pd.plan.id, round_id: null, status: 'lobby',
            payload: { mode: 'groups', kind, title: `${pd.plan.name} — ${kind === 'car' ? 'Cars' : 'Rooms'}`, field, groups: slots, keep, pace, interval_ms: REVEAL_MS, k: slots.length },
          }));
          await feedPost(status.player_id, pd.plan, `🎲 The ${word} draw is open for ${pd.plan.name} — open the app to watch.`);
          await notify('draw_open', {});
          onClose();
        })}>🎲 Open the draw room</button>
      </div>
    </Sheet>
  );
}

