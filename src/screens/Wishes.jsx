import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { Header, Loading } from '../components/ui.jsx';
import { groupWishes, failRate, topTools, toolName, errorName } from '../lib/wishes.js';
import AiUsage from '../components/AiUsage.jsx';

// The connector's learning loop (Stage 13, migration 057): Josh's Wishes screen, #/wishes. Platform admins only —
// the database refuses everyone else, and this screen says so.
//  * Wished for: one-line jobs the assistant couldn't do (suggest_feature), similar ones put together, most asked first.
//  * Tool calls: how often each group uses the connector, which tools, and how often they fail.
// Counts and one-line jobs only: no chat text, no tool arguments.

const when = (t) => (t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—');

function Stat({ label, value }) {
  return (
    <div className="card" style={{ padding: '10px 6px', textAlign: 'center' }}>
      <div className="num" style={{ fontSize: 24, fontWeight: 700 }}>{value ?? 0}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

export default function Wishes() {
  const [days, setDays] = useState(90);
  const [tab, setTab] = useState('wishes');
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.all([supabase.rpc('admin_wishes', { p_days: days }), supabase.rpc('admin_connector_stats', { p_days: days })])
      .then(([w, s]) => {
        if (!live) return;
        const error = w.error || s.error;
        setState({ loading: false, error: error ? (error.message || 'Couldn’t load') : '', wishes: w.data || [], stats: s.data || null });
      }, (e) => { if (live) setState({ loading: false, error: e?.message || 'Couldn’t load' }); });
    return () => { live = false; };
  }, [days]);
  const grouped = useMemo(() => groupWishes(state.wishes), [state.wishes]);
  const st = state.stats;
  const refused = state.error && /only josh/i.test(state.error);

  return (
    <div className="page">
      <Header back title="Wishes" sub="What organisers ask their assistant for" />
      {refused ? <div className="empty">Only Josh can see this.</div> : (
        <div className="section stack" style={{ gap: 12, paddingBottom: 24 }}>
          <div className="seg light" role="group" aria-label="Show">
            {[['wishes', 'Wished for'], ['calls', 'Tool calls'], ['ai', '✨ The Caddie']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option><option value={3650}>All time</option>
          </select>
          {state.loading && <Loading />}
          {!state.loading && state.error && <div className="err" role="alert">Couldn’t load: {state.error}</div>}
          {!state.loading && !state.error && tab === 'wishes' && <WishList grouped={grouped} />}
          {!state.loading && !state.error && tab === 'calls' && <Calls st={st} />}
          {!state.loading && !state.error && tab === 'ai' && <AiUsage days={days} />}
          <p className="note" style={{ margin: '4px 4px 0' }}>
            Counts and one-line jobs only. The assistant’s chats and what it was asked are never seen here.
            Each release, pick the 1–3 most-wanted jobs to move up a step: the assistant does it → its own tool → a one-tap button → automatic.
          </p>
        </div>
      )}
    </div>
  );
}

function WishList({ grouped }) {
  if (!grouped.length) return <div className="empty">No wishes yet. When an organiser asks their assistant for something it can’t do, it shows up here.</div>;
  return (
    <div className="stack" style={{ gap: 8 }} aria-label="Wishes">
      {grouped.map((w, i) => (
        <div key={w.key} className="card pad stack" style={{ gap: 4 }} data-testid="wish">
          <div className="row between" style={{ gap: 8, alignItems: 'flex-start' }}>
            <strong style={{ overflowWrap: 'anywhere' }}>{i + 1}. {w.job}</strong>
            <span className="num" style={{ flex: 'none', fontWeight: 700 }}>{w.times}×</span>
          </div>
          <span className="small muted">{w.groups} group{w.groups === 1 ? '' : 's'} · last {when(w.last)} · {w.groupNames.join(', ')}</span>
          {w.wordings.length > 1 && <span className="small muted" style={{ overflowWrap: 'anywhere' }}>Also put as: {w.wordings.filter((x) => x !== w.job).map((x) => `“${x}”`).join(', ')}</span>}
        </div>
      ))}
    </div>
  );
}

function Calls({ st }) {
  if (!st || !st.calls) return <div className="empty">No tool calls yet. They show here once a group connects its assistant.</div>;
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 };
  const cell = { padding: '8px 6px' };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={grid}>
        <Stat label="Calls" value={st.calls} />
        <Stat label={`Failed (${failRate(st.calls, st.failed)}%)`} value={st.failed} />
        <Stat label="Groups using it" value={st.groups_using} />
      </div>

      <strong>Most used tools</strong>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }} aria-label="Tools">
          <thead><tr style={{ textAlign: 'left' }}><th style={cell}>Tool</th><th style={cell}>Calls</th><th style={cell}>Failed</th><th style={cell}>Avg time</th></tr></thead>
          <tbody>
            {(st.tools || []).map((t) => (
              <tr key={t.tool} style={{ borderTop: '1px solid var(--line, #E3E6EA)' }}>
                <td style={cell}>{toolName(t.tool)}</td><td style={cell}>{t.calls}</td>
                <td style={cell}>{t.failed ? `${t.failed} (${failRate(t.calls, t.failed)}%)` : '—'}</td>
                <td style={cell}>{t.avg_ms != null ? `${(Number(t.avg_ms) / 1000).toFixed(1)} s` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <strong>By group</strong>
      <div className="stack" style={{ gap: 8 }}>
        {(st.groups || []).map((g) => (
          <div key={g.group_id} className="card pad stack" style={{ gap: 4 }} data-testid="group-calls">
            <div className="row between" style={{ gap: 8 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>{g.group_name || 'A group'}</strong>
              <span className="small muted" style={{ flex: 'none' }}>last {when(g.last_used)}</span>
            </div>
            <span className="small">{g.calls} call{g.calls === 1 ? '' : 's'} · {g.failed ? `${g.failed} failed (${failRate(g.calls, g.failed)}%)` : 'none failed'}</span>
            <span className="small muted">Most used: {topTools(g.tools).map((t) => `${toolName(t.tool)} ${t.calls}`).join(' · ') || '—'}</span>
          </div>
        ))}
      </div>

      {(st.errors || []).length > 0 && (
        <>
          <strong>Why calls failed</strong>
          <div className="card pad stack" style={{ gap: 4 }}>
            {st.errors.slice(0, 12).map((e) => (
              <span key={`${e.tool}-${e.error}`} className="small">{toolName(e.tool)}: {errorName(e.error)} — {e.times}×</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
