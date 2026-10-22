// The AI helper's numbers on Josh's Wishes screen (migration 065, admin_ai_usage — platform admins only):
// do people want it? Requests a week by area, groups using it, 👍 / 👎, cap hits, errors, and tokens (the cost
// proxy) by model. Counts only: no questions, no answers, no names of people.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Loading } from './ui.jsx';
import AbResults from './AbResults.jsx';
import { areaName, errorLabel, upShare, tokens, weekRows } from '../lib/aiusage.js';

const when = (t) => (t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—');
const cell = { padding: '8px 6px' };

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: '10px 6px', textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>{value ?? 0}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

export default function AiUsage({ days }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    supabase.rpc('admin_ai_usage', { p_days: days }).then(
      ({ data, error }) => live && setState({ loading: false, error: error ? error.message || 'Couldn’t load' : '', u: data || null }),
      (e) => live && setState({ loading: false, error: e?.message || 'Couldn’t load' }),
    );
    return () => { live = false; };
  }, [days]);
  if (state.loading) return <Loading />;
  if (state.error) return <div className="err" role="alert">Couldn’t load the AI numbers: {state.error}</div>;
  const u = state.u;
  if (!u || (!u.requests && !u.cap_hits)) return <><div className="empty">No AI helper questions yet. They show here once groups start asking.</div><AbResults days={days} /></>;
  const share = upShare(u.up, u.down);
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 };
  const weeks = weekRows(u.weeks);
  return (
    <div className="stack" style={{ gap: 12 }} aria-label="AI helper usage">
      <div style={grid}>
        <Stat label="Questions" value={u.requests} />
        <Stat label="Groups using it" value={u.groups_using} />
        <Stat label="People" value={u.people_using} />
        <Stat label={`👍 ${u.up} · 👎 ${u.down}`} value={share == null ? '—' : `${share}%`} />
        <Stat label="Hit the limit" value={u.cap_hits} />
        <Stat label="Went wrong" value={u.failed} />
      </div>
      <span className="small muted">
        Made with “Do it” / “Create it”: {u.applied}{u.apply_failed ? ` (${u.apply_failed} refused)` : ''} ·
        tokens {tokens(u.tokens_in)} in, {tokens(u.tokens_out)} out (about {tokens(u.avg_in)} + {tokens(u.avg_out)} a question) ·
        about {u.avg_ms ? (u.avg_ms / 1000).toFixed(1) : '—'} s a question
      </span>

      <strong>Where people use it</strong>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="By area">
          <thead><tr style={{ textAlign: 'left' }}><th style={cell}>Where</th><th style={cell}>Asked</th><th style={cell}>👍/👎</th><th style={cell}>Tokens</th></tr></thead>
          <tbody>
            {(u.areas || []).map((a) => (
              <tr key={a.area} style={{ borderTop: '1px solid var(--line, #E3E6EA)' }}>
                <td style={cell}>{areaName(a.area)}</td>
                <td style={cell}>{a.requests}{a.failed ? ` (${a.failed} failed)` : ''}</td>
                <td style={cell}>{a.up}/{a.down}</td>
                <td style={cell}>{tokens(a.avg_in)} + {tokens(a.avg_out)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {weeks.rows.length > 0 && (
        <>
          <strong>Each week</strong>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Each week">
              <thead><tr style={{ textAlign: 'left' }}><th style={cell}>Week of</th>{weeks.areas.map((a) => <th key={a} style={cell}>{areaName(a).replace(/ \(.*\)$/, '')}</th>)}<th style={cell}>All</th></tr></thead>
              <tbody>
                {weeks.rows.map((w) => (
                  <tr key={w.week} style={{ borderTop: '1px solid var(--line, #E3E6EA)' }}>
                    <td style={cell}>{w.label}</td>
                    {weeks.areas.map((a) => <td key={a} style={cell}>{w.byArea[a] || 0}</td>)}
                    <td style={{ ...cell, fontWeight: 700 }}>{w.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <strong>By group</strong>
      <div className="stack" style={{ gap: 8 }}>
        {(u.groups || []).map((g) => (
          <div key={g.group_id} className="card pad stack" style={{ gap: 4 }} data-testid="ai-group">
            <div className="row between" style={{ gap: 8 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{g.group_name || 'A group'}</strong>
              <span className="small muted" style={{ flex: 'none' }}>last {when(g.last_used)}</span>
            </div>
            <span className="small">{g.requests} question{g.requests === 1 ? '' : 's'} · {g.people} {g.people === 1 ? 'person' : 'people'} · 👍 {g.up} 👎 {g.down}{g.cap_hits ? ` · hit the limit ${g.cap_hits}×` : ''}</span>
          </div>
        ))}
      </div>

      {(u.models || []).length > 0 && (
        <>
          <strong>Which AI answered</strong>
          <div className="card pad stack" style={{ gap: 4 }}>
            {u.models.map((m) => (
              <span key={`${m.provider}-${m.model}`} className="small" style={{ overflowWrap: 'anywhere' }}>
                {m.provider === '?' ? 'Before v2' : `${m.provider} · ${m.model}`}: {m.requests} question{m.requests === 1 ? '' : 's'}{m.failed ? ` (${m.failed} failed)` : ''} · about {tokens(m.avg_in)} + {tokens(m.avg_out)} tokens each
              </span>
            ))}
          </div>
        </>
      )}

      <AbResults days={days} />

      {(u.errors || []).length > 0 && (
        <>
          <strong>What went wrong</strong>
          <div className="card pad stack" style={{ gap: 4 }}>
            {u.errors.map((e) => <span key={e.error} className="small">{errorLabel(e.error)} — {e.times}×</span>)}
          </div>
        </>
      )}
    </div>
  );
}
