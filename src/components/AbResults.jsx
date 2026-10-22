// The A/B model test on Josh's Wishes screen, AI helper tab (22 Oct 2026, migration 075, admin_ai_abtest —
// platform admins only). Model A vs model B side by side: questions, people, 👍 share, 👎 reasons, errors, median
// time, tokens and rough cost; a plain-words verdict worked out in code (lib/abstats.js), never by the AI; the latest
// 👎 notes; and how to run a test.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { abView } from '../lib/abstats.js';
import { tokens } from '../lib/aiusage.js';
import { reasonLabel } from '../lib/feedback.js';

const cell = { padding: '8px 6px', verticalAlign: 'top', overflowWrap: 'anywhere' };
const when = (t) => (t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '');

function HowTo({ open }) {
  return (
    <details className="card pad small" open={open} style={{ lineHeight: 1.5 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 32 }}>How to run a model test</summary>
      <ol style={{ margin: '8px 0 0', paddingLeft: 20 }} className="stack">
        <li>In Supabase → Edge Functions → Secrets, add <code>AI_MODEL_B</code> with the second model’s id. It uses model A’s provider, address and key unless you also set <code>AI_PROVIDER_B</code>, <code>AI_BASE_URL_B</code> or <code>AI_API_KEY_B</code>.</li>
        <li>Optional: <code>AI_AB_SPLIT</code> — the % of people who get B (50 if not set). Each person keeps the same model for the whole test.</li>
        <li>Wait for at least 30 rated answers on each model. The verdict below says when one is better.</li>
        <li>To start a fresh test, change <code>AI_AB_SALT</code> (e.g. <code>ab2</code>): people are shuffled again and only the new test is counted here.</li>
        <li>To stop, delete <code>AI_MODEL_B</code> — everyone goes back to model A. If B ever fails, A answers instead (shown as “fell back”).</li>
        <li>Optional rough cost: <code>AI_PRICE_IN</code>, <code>AI_PRICE_OUT</code> (and <code>_B</code>) in US$ per million tokens.</li>
      </ol>
    </details>
  );
}

export default function AbResults({ days }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    supabase.rpc('admin_ai_abtest', { p_days: days }).then(
      ({ data, error }) => live && setState({ loading: false, error: !!error, data: data || null }),
      () => live && setState({ loading: false, error: true }),
    );
    return () => { live = false; };
  }, [days]);
  if (state.loading) return null;
  if (state.error) return <HowTo />; // the results aren't there yet (075 not applied) — still show how
  const v = abView(state.data);
  const notes = (state.data?.notes || []).slice(0, 10);
  const rows = v ? [
    ['Model', (r) => <><code>{r.model}</code>{r.otherModels.length ? <span className="muted"> (+{r.otherModels.join(', ')})</span> : null}</>],
    ['Questions', (r) => r.questions],
    ['People', (r) => r.people],
    ['👍 share', (r) => (r.upShare == null ? '—' : <><strong>{r.upShare}%</strong> <span className="muted">({r.up} 👍 · {r.down} 👎)</span></>)],
    ['👎 because', (r) => r.reasons],
    ['Went wrong', (r) => `${r.failed}${r.errorRate != null ? ` (${r.errorRate}%)` : ''}${r.fallbacks ? ` · fell back to A ${r.fallbacks}×` : ''}`],
    ['Median time', (r) => r.median],
    ['Tokens in / out', (r) => `${tokens(r.tokensIn)} / ${tokens(r.tokensOut)}`],
    ...((v.A?.cost || v.B?.cost) ? [['Rough cost', (r) => r.cost || '—']] : []),
  ] : [];
  return (
    <div className="stack" style={{ gap: 10 }} aria-label="Model test">
      <strong>Model test (A vs B)</strong>
      {!v && <span className="small muted">No model test data yet. Every question is logged as model A until you add a model B.</span>}
      {v && (
        <>
          <span className="small muted">Test “{v.name}”{v.running ? '' : ' — only one model has answered so far'}</span>
          {v.verdict && (
            <div className="card pad" role="status" aria-label="Verdict" style={{ borderColor: v.verdict.kind === 'A' || v.verdict.kind === 'B' ? 'var(--gold)' : undefined, fontWeight: 700 }}>
              {v.verdict.kind === 'A' || v.verdict.kind === 'B' ? '🏆 ' : '⏳ '}{v.verdict.text}
            </div>
          )}
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }} aria-label="A vs B">
              <thead><tr style={{ textAlign: 'left' }}><th style={{ ...cell, width: '30%' }} /><th style={cell}>A</th><th style={cell}>B</th></tr></thead>
              <tbody>
                {rows.map(([label, f]) => (
                  <tr key={label} style={{ borderTop: '1px solid var(--line, #E3E6EA)' }}>
                    <th style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{label}</th>
                    <td style={cell}>{v.A ? f(v.A) : '—'}</td>
                    <td style={cell}>{v.B ? f(v.B) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {notes.length > 0 && (
        <>
          <strong>Latest 👎 notes</strong>
          <div className="card pad stack" style={{ gap: 6 }} aria-label="Latest notes">
            {notes.map((n, i) => (
              <span key={i} className="small" style={{ overflowWrap: 'anywhere' }}>
                <span className="muted">{when(n.at)} · {n.variant || '?'} · {reasonLabel(n.reason)}:</span> {n.note}
              </span>
            ))}
          </div>
        </>
      )}
      <HowTo open={!v || !v.running} />
    </div>
  );
}
