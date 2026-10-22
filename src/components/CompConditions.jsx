// Side comp conditions (migration 073): the line on a comp's card and entry screen ("Fairway only · first shot"),
// and the organiser's editor. Closest to the pin / longest drive keep theirs in side_comp_conditions; the group's
// own and library comps in side_comp_defs.conditions. The rules for the words are in lib/conditions.js.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRealtime, useFeature } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { Sheet } from './ui.jsx';
import { conditionsFor, cleanConditions, conditionsLine, takesConditions, NOTE_MAX } from '../lib/conditions.js';

/** The group's closest-to-pin and longest-drive conditions, live: { ctp: {...} | null, ld: {...} | null }. */
export function useBuiltinConditions() {
  const on = useFeature('side_comps');
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    if (!on) { setRows([]); return; }
    const { data, error } = await supabase.from('side_comp_conditions').select('*');
    if (!error) setRows(data || []);
  }, [on]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['side_comp_conditions'], load);
  const by = Object.fromEntries(rows.map((r) => [r.comp, r]));
  return [{ ctp: by.ctp?.conditions || null, ld: by.ld?.conditions || null, rows: by }, load];
}

/** The conditions line on a comp. comp: 'ctp' | 'ld' | a side_comp_defs row. Nothing if there are none. */
export function ConditionsLine({ comp, style }) {
  if (typeof comp === 'string') return <BuiltinLine comp={comp} style={style} />;
  return <Line c={comp?.conditions} style={style} />;
}

function BuiltinLine({ comp, style }) {
  const [builtin] = useBuiltinConditions();
  return <Line c={builtin[comp]} style={style} />;
}

function Line({ c, style }) {
  const line = conditionsLine(c);
  if (!line) return null;
  return (
    <div className="small" data-testid="comp-conditions" style={{ padding: '6px 10px', borderRadius: 10, background: '#EEF1F5', fontWeight: 600, ...style }}>
      📋 {line}
    </div>
  );
}

/** Organiser: pick the comp's conditions. target: 'ctp' | 'ld' | a side_comp_defs row. */
export function ConditionsSheet({ target, current, existingId, name, onClose, onSaved }) {
  const [busy, run] = useRun();
  const start = cleanConditions(current) || { picks: [] };
  const [picks, setPicks] = useState(start.picks);
  const [note, setNote] = useState(start.note || '');
  const options = conditionsFor(target);
  const toggle = (k) => setPicks(picks.includes(k) ? picks.filter((x) => x !== k) : [...picks, k]);
  const save = () => run(async () => {
    const conditions = cleanConditions({ picks, note });
    if (typeof target === 'string') {
      if (existingId) await must(supabase.from('side_comp_conditions').update({ conditions }).eq('id', existingId));
      else await must(supabase.from('side_comp_conditions').insert({ comp: target, conditions }));
    } else {
      await must(supabase.from('side_comp_defs').update({ conditions }).eq('id', target.id));
    }
    await onSaved?.();
    onClose();
  }, 'Conditions saved');
  const preview = conditionsLine({ picks, note });
  return (
    <Sheet title={`${name} — conditions`} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <span className="small muted">Standard options for this comp — tick the ones you play. They show on the comp and when someone enters a shot.</span>
        {options.map((o) => (
          <label key={o.key} className="row" style={{ gap: 10, minHeight: 44 }}>
            <input type="checkbox" checked={picks.includes(o.key)} onChange={() => toggle(o.key)} style={{ width: 22, height: 22 }} />
            <span>{o.label}</span>
          </label>
        ))}
        <label className="field"><span>Anything else (optional)</span>
          <input className="input" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="e.g. the cart path counts as fairway" />
        </label>
        {preview && <div className="small"><strong>Shows as:</strong> {preview}</div>}
        <button type="button" className="btn gold block" disabled={busy} onClick={save}>Save conditions</button>
      </div>
    </Sheet>
  );
}

/** A "Conditions" button for one comp (organisers), with the current line beside it. */
export function ConditionsButton({ comp, name, onSaved }) {
  const [builtin, reload] = useBuiltinConditions();
  const [open, setOpen] = useState(false);
  if (!takesConditions(comp)) return null;
  const builtinRow = typeof comp === 'string' ? builtin.rows[comp] : null;
  const current = typeof comp === 'string' ? builtin[comp] : comp.conditions;
  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)} data-testid="conditions-button">Conditions</button>
      {open && <ConditionsSheet target={comp} current={current} existingId={builtinRow?.id} name={name}
        onClose={() => setOpen(false)} onSaved={async () => { await reload(); await onSaved?.(); }} />}
    </>
  );
}

/** Organiser list: closest to pin and longest drive, with their conditions. */
export function BuiltinConditionsAdmin() {
  const on = useFeature('side_comps');
  const [builtin, reload] = useBuiltinConditions();
  if (!on) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {[['ctp', '🎯 Closest to the pin'], ['ld', '💣 Longest drive']].map(([k, label]) => (
        <div key={k} className="row" style={{ gap: 8 }}>
          <div className="grow"><strong>{label}</strong><div className="small muted">{conditionsLine(builtin[k]) || 'No conditions — standard rules'}</div></div>
          <ConditionsButton comp={k} name={label.replace(/^\S+ /, '')} onSaved={reload} />
        </div>
      ))}
    </div>
  );
}
