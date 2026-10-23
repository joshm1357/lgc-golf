// Custom games (migration 073): the group's own saved version of a standard game — its own name, stake and options,
// plus house rules if they like (optional since 098). Every standard option (carry-overs, validated skins, Nassau
// values and presses…) can also be picked on any round without saving a game. The Games screen's "Your own games" card and the hook the round pickers use.
// The rules for what's allowed are in lib/customgames.js.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRealtime, useFeature, useSession } from '../lib/store.jsx';
import { useRun, must } from '../lib/run.js';
import { Sheet } from './ui.jsx';
import { GAME_KINDS, GAME_INFO, STANDARD_OPTIONS } from '../lib/games.js';
import { copyFrom, customProblems, customRow, customSummary, cleanCustomSettings, houseRules, RULES_MAX, NAME_MAX } from '../lib/customgames.js';

/** The group's custom games (put-away ones too — screens filter), live. An older database has none. */
export function useCustomGames() {
  const on = useFeature('games');
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    if (!on) { setList([]); return; }
    const { data, error } = await supabase.from('custom_games').select('*').order('created_at');
    if (!error) setList(data || []);
  }, [on]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['custom_games'], load);
  return [list, load];
}

/** The standard options of a game as toggles / choices / money boxes. value: full options; onChange(next). */
export function OptionControls({ kind, value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="stack" style={{ gap: 8 }}>
      {(STANDARD_OPTIONS[kind] || []).map((spec) => {
        if (spec.type === 'bool') {
          return (
            <div key={spec.key} className="stack" style={{ gap: 2 }}>
              <div className="seg" role="group" aria-label={spec.key}>
                <button type="button" aria-pressed={value[spec.key] === true} onClick={() => set(spec.key, true)}>{spec.on}</button>
                <button type="button" aria-pressed={value[spec.key] === false} onClick={() => set(spec.key, false)}>{spec.off}</button>
              </div>
              {spec.help && <span className="small muted">{spec.help}</span>}
            </div>
          );
        }
        if (spec.type === 'enum') {
          return (
            <div key={spec.key} className="stack" style={{ gap: 2 }}>
              <div className="seg" role="group" aria-label={spec.key}>
                {spec.values.map((v) => <button key={String(v)} type="button" aria-pressed={value[spec.key] === v} onClick={() => set(spec.key, v)}>{spec.labels?.[v] ?? String(v)}</button>)}
              </div>
              {spec.help && <span className="small muted">{spec.help}</span>}
            </div>
          );
        }
        return (
          <label key={spec.key} className="field"><span>{spec.label}{spec.help ? ` — ${spec.help.toLowerCase()}` : ''}</span>
            <input className="input" inputMode="decimal" style={{ maxWidth: 140 }} value={value[spec.key] ?? ''}
              onChange={(e) => set(spec.key, e.target.value.trim() === '' ? null : e.target.value)} />
          </label>
        );
      })}
    </div>
  );
}

/** Numbers typed into the money boxes → numbers (the checks want numbers). */
function moneyToNumbers(kind, s) {
  const out = { ...s };
  for (const spec of STANDARD_OPTIONS[kind] || []) if (spec.type === 'money' && out[spec.key] != null) out[spec.key] = Number(String(out[spec.key]).replace(/[$,\s]/g, ''));
  if (out.stake != null) out.stake = Number(String(out.stake).replace(/[$,\s]/g, ''));
  return out;
}

/** Copy and change: name, the standard options, the stake and (optional) house rules. */
export function CustomGameSheet({ start, existing, onClose, onSaved }) {
  const { status } = useSession();
  const [busy, run] = useRun();
  const [v, setV] = useState(() => existing ? { ...existing, rules_text: existing.rules_text ?? '', settings: cleanCustomSettings(existing.base_type, existing.settings) } : start);
  const draft = { ...v, settings: moneyToNumbers(v.base_type, v.settings) };
  const problems = customProblems(draft);
  const save = () => run(async () => {
    const row = customRow(draft);
    if (existing) await must(supabase.from('custom_games').update(row).eq('id', existing.id));
    else await must(supabase.from('custom_games').insert({ ...row, created_by: status.player_id || null }));
    await onSaved?.();
    onClose();
  }, existing ? 'Saved' : `${draft.name.trim()} saved — pick it for any round`);
  return (
    <Sheet title={existing ? `Change ${existing.name}` : `Your own ${GAME_INFO[v.base_type]?.name}`} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <span className="small muted">Save it as the group’s own {GAME_INFO[v.base_type]?.name} — its name, stake and options — to pick for any round in one tap. Add house rules if you’ve got a twist of your own.</span>
        <label className="field"><span>Name</span><input className="input" value={v.name} maxLength={NAME_MAX} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <OptionControls kind={v.base_type} value={v.settings} onChange={(s) => setV({ ...v, settings: { ...s, stake: v.settings.stake } })} />
        <label className="field"><span>Stake ($, {GAME_INFO[v.base_type]?.per})</span>
          <input className="input" inputMode="decimal" style={{ maxWidth: 140 }} value={v.settings.stake ?? ''} onChange={(e) => setV({ ...v, settings: { ...v.settings, stake: e.target.value } })} />
        </label>
        <label className="field"><span>House rules (optional)</span>
          <textarea className="textarea" rows={4} style={{ padding: 12 }} maxLength={RULES_MAX} value={v.rules_text} onChange={(e) => setV({ ...v, rules_text: e.target.value })} data-testid="custom-house-rules"
            placeholder="e.g. A skin won with a birdie is worth double. Loser of the last skin shouts the first round." />
        </label>
        <span className="small muted">The app works out the money with the options above. Any house rules are shown with the game for everyone to see — leave it blank if there aren’t any.</span>
        {problems.length > 0 && <span className="small err" style={{ margin: 0 }}>{problems[0]}</span>}
        <button type="button" className="btn gold block" disabled={busy || problems.length > 0} onClick={save}>Save {existing ? 'changes' : 'our game'}</button>
      </div>
    </Sheet>
  );
}

/** The Games screen card: the group's own games, and "Copy and change" on each standard game (organisers). */
export function CustomGamesCard() {
  const on = useFeature('games');
  const { status } = useSession();
  const [list, reload] = useCustomGames();
  const [busy, run] = useRun();
  const [editing, setEditing] = useState(null); // { start } | { existing }
  if (!on) return null;
  const live = list.filter((c) => !c.retired);
  const organiser = status.is_admin && !status.viewing;
  if (!live.length && !organiser) return null;
  return (
    <div className="card pad stack" style={{ gap: 10 }} data-testid="custom-games">
      <strong style={{ fontSize: 18 }}>🎲 Your own games</strong>
      {live.length === 0 && <div className="small muted">Every standard option (carry-overs, validated skins, Nassau presses…) can be picked on any round. Copy a game here to save your group’s own version — its name, stake and options, plus house rules if you like.</div>}
      {live.map((c) => (
        <div key={c.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line-soft)', paddingTop: 8 }} data-testid="custom-game">
          <div className="row between" style={{ gap: 8 }}>
            <strong>{GAME_INFO[c.base_type]?.emoji} {c.name}</strong>
            {organiser && (
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn ghost sm" onClick={() => setEditing({ existing: c })}>Change</button>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(async () => { await must(supabase.from('custom_games').update({ retired: true }).eq('id', c.id)); await reload(); }, `${c.name} put away`)}>Put away</button>
              </span>
            )}
          </div>
          <div className="small muted">{customSummary(c)}</div>
          {houseRules(c) && <div className="small" style={{ whiteSpace: 'pre-wrap' }} data-testid="custom-game-rules"><strong>House rules:</strong> {houseRules(c)}</div>}
        </div>
      ))}
      {organiser && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Copy and change a standard game</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {GAME_KINDS.map((k) => <button key={k} type="button" className="chip" onClick={() => setEditing({ start: copyFrom(k) })}>{GAME_INFO[k].emoji} Copy {GAME_INFO[k].name}</button>)}
          </div>
        </div>
      )}
      {editing && <CustomGameSheet start={editing.start} existing={editing.existing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
