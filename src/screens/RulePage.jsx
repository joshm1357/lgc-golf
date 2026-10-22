// Tap any rule to open it (v2.1 fix + Stage 11b): its wording, when it came in, who proposed it, the vote, past
// versions, rulings, any change waiting for the next trip, and "Challenge this rule".
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useRealtime, useSession, playerName, useFeature } from '../lib/store.jsx';
import { Header, Loading, timeAgo } from '../components/ui.jsx';
import { useGovernance, RaiseCase } from './Cases.jsx';
import { challengeBlock, sydneyDate, applyWords, canRaise, KIND } from '../lib/governance.js';
import { RuleSheet, Chips } from './Rulebook.jsx';
import { RuleScopeLine } from '../components/RuleLayers.jsx';
import { LateRuleNumbers } from '../components/LateJobs.jsx';

const EVENT = { recorded: 'In the Rulebook', proposed: 'Proposed', added: 'Added', adopted: 'Adopted', rejected: 'Rejected', changed: 'Changed', retired: 'Retired', restored: 'Brought back' };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function RulePage() {
  const { ruleId } = useParams();
  const data = useData();
  const { status } = useSession();
  const g = useGovernance();
  const challengesSwitch = useFeature('rule_challenges');
  const votingSwitch = useFeature('rule_voting');
  const challengesOn = challengesSwitch && votingSwitch;
  const [d, setD] = useState(null);
  const [challenge, setChallenge] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    const [r, v, rr] = await Promise.all([
      supabase.from('rules').select('*').eq('id', ruleId),
      supabase.from('rule_versions').select('*').eq('rule_id', ruleId).order('created_at'),
      supabase.from('round_rule_versions').select('round_id,version').eq('rule_id', ruleId),
    ]);
    setD({ rule: (r.data || [])[0] || null, versions: v.error ? [] : v.data || [], rounds: rr.error ? [] : rr.data || [] });
  }, [ruleId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['rules', 'rule_versions'], load);
  if (!d) return <div className="page"><Header back title="The Rulebook" /><Loading /></div>;
  const rule = d.rule;
  if (!rule) return <div className="page"><Header back title="Rule not found" /></div>;
  const cases = g?.ok ? g.cases.filter((c) => c.rule_id === rule.id) : [];
  const openCase = cases.find((c) => c.status === 'open');
  const waiting = cases.find((c) => c.status === 'passed' && ['waiting_next_trip', 'next_round'].includes(c.apply_state));
  const rulings = cases.filter((c) => c.kind === 'ruling' && c.status === 'passed' && c.verdict);
  const origin = d.versions.find((v) => ['adopted', 'added'].includes(v.event)) || d.versions[0];
  const intro = cases.find((c) => c.kind === 'new_rule');
  const by = data.playersById[rule.proposed_by];
  const nextTrip = [...data.trips].filter((t) => t.start_date && t.start_date > sydneyDate()).sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const block = g?.ok ? challengeBlock({ ruleId: rule.id, cases: g.cases, trips: data.trips, today: sydneyDate() }) : null;
  const canChallenge = g?.ok && challengesOn && rule.status === 'active' && status.role !== 'guest'
    && ['change_rule', 'scrap_rule', 'ruling'].some((k) => canRaise({ role: status.role, settings: g.settings[k] }));
  // Organisers edit directly only where the group's decision rule says an organiser decides (L.G.C does).
  const directEdit = status.is_admin && (!g?.ok || g.settings.change_rule.decides === 'organiser');
  const versionsDesc = [...d.versions].reverse();
  const roundsByVersion = d.rounds.reduce((m, r) => ({ ...m, [r.version]: (m[r.version] || 0) + 1 }), {});
  return (
    <div className="page">
      <Header back title={rule.title} sub={rule.status === 'active' ? 'In the Rulebook' : rule.status === 'proposed' ? 'Up for a vote' : rule.status === 'retired' ? 'Retired' : 'Rejected'} />
      <div className="section stack">
        <div className="card pad stack" style={{ gap: 8 }} data-testid="rule-wording">
          <strong style={{ fontSize: 18 }}>{rule.title}</strong>
          <Chips rule={rule} />
          <RuleScopeLine rule={rule} />
          {rule.system_key === 'late_job' && <LateRuleNumbers rule={rule} />}
          {rule.detail && <div style={{ fontSize: 16, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{rule.detail}</div>}
          <div className="small muted">
            {origin ? `${EVENT[origin.event] || 'In the Rulebook'} ${fmtDate(rule.decided_at || origin.created_at)}` : `Since ${fmtDate(rule.decided_at || rule.created_at)}`}
            {by ? ` · proposed by ${playerName(by)}` : ''}
            {intro?.votes_for != null ? ` · vote ${intro.votes_for}–${intro.votes_against}` : rule.decision_note ? ` · ${rule.decision_note}` : ''}
          </div>
        </div>

        {waiting && (
          <Link to={`/tribunal/case/${waiting.id}`} className="card pad court-card" style={{ color: 'inherit', textDecoration: 'none' }} data-testid="pending-change">
            <strong>{applyWords(waiting, nextTrip?.name || 'the next trip')}</strong>
            <div className="small">{KIND[waiting.kind]?.label}: {waiting.kind === 'change_rule' ? `${waiting.proposal?.title}${waiting.proposal?.value ? ` (${waiting.proposal.value})` : ''}` : waiting.title}</div>
          </Link>
        )}
        {openCase && (
          <Link to={`/tribunal/case/${openCase.id}`} className="card pad" style={{ color: 'inherit', textDecoration: 'none', borderColor: 'var(--gold)' }}>
            <strong>⚖️ Before the Tribunal: {openCase.title}</strong>
            <div className="small muted">{KIND[openCase.kind]?.label} · tap to see the hearing and vote</div>
          </Link>
        )}

        {canChallenge && !openCase && (
          block
            ? <div className="small muted">{block}</div>
            : <button type="button" className="btn gold block" onClick={() => setChallenge(true)}>⚖️ Challenge this rule</button>
        )}
        {directEdit && <button type="button" className="btn ghost block" onClick={() => setEditing(true)}>Edit (organiser)</button>}

        {rulings.length > 0 && (
          <div className="card pad stack" style={{ gap: 6 }}>
            <span className="label">Rulings</span>
            {rulings.map((c) => (
              <Link key={c.id} to={`/tribunal/case/${c.id}`} style={{ color: 'inherit' }}>
                <div className="small"><strong>{c.title}</strong></div>
                <div>{c.verdict}</div>
                <div className="small muted">{fmtDate(c.decided_at)}</div>
              </Link>
            ))}
          </div>
        )}

        <div className="card pad stack" style={{ gap: 8 }} data-testid="rule-history">
          <span className="label">History</span>
          {!versionsDesc.length && <div className="small muted">No changes recorded yet.</div>}
          {versionsDesc.map((v) => (
            <div key={v.id} className="stack" style={{ gap: 2, borderTop: '1px solid var(--line-soft)', paddingTop: 6 }}>
              <div className="row between small"><strong>Version {v.version} · {EVENT[v.event] || v.event}</strong><span className="muted">{fmtDate(v.created_at)}</span></div>
              <div className="small">{v.title}{v.value ? ` (${v.value})` : ''}</div>
              {v.detail && <div className="small muted">{v.detail}</div>}
              {v.note && <div className="small muted">{v.note}</div>}
              {roundsByVersion[v.version] && v === versionsDesc.find((x) => x.version === v.version) && <div className="small muted">Played under in {roundsByVersion[v.version]} round{roundsByVersion[v.version] === 1 ? '' : 's'}</div>}
              {v.case_id && <Link to={`/tribunal/case/${v.case_id}`} className="small">The case →</Link>}
            </div>
          ))}
        </div>
        {cases.filter((c) => c.status !== 'open' && c.kind !== 'ruling' && c.kind !== 'new_rule').map((c) => (
          <Link key={c.id} to={`/tribunal/case/${c.id}`} className="small muted">{KIND[c.kind]?.label}: {c.title} — {c.status} {timeAgo(c.decided_at)}</Link>
        ))}
      </div>
      {challenge && g?.ok && <RaiseCase g={g} rule={rule} kind="change_rule" onClose={() => setChallenge(false)} />}
      {editing && <RuleSheet rule={rule} settings={g?.ok ? g.settings : null} onClose={() => setEditing(false)} onSaved={load} />}
    </div>
  );
}
