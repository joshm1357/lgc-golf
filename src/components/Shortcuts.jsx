// Stage 11c — keyboard shortcuts on a laptop: "?" shows the list, "/" finds a screen or a player, "g t" Trips,
// "g l" the leaderboard, "n" new, Esc closes. The key handling is in lib/shortcuts.js. Nothing shows on a phone
// unless a keyboard is used, and shortcuts never fire while typing in a box.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData, useFeature, useSession, playerName } from '../lib/store.jsx';
import { SHORTCUTS, nextKey, isTyping, findItems } from '../lib/shortcuts.js';
import '../desktop.css';

export function Shortcuts() {
  const nav = useNavigate();
  const [open, setOpen] = useState(null); // 'help' | 'find'
  const st = useRef({});
  useEffect(() => {
    const onKey = (e) => {
      const { state, action } = nextKey(st.current, e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, typing: isTyping(e.target) || e.defaultPrevented });
      st.current = state;
      if (!action) return;
      if (action.type === 'close') { setOpen(null); return; }
      // Another dialog (a sheet) is open: leave the page alone.
      if (document.querySelector('.sheet-bg, .present, .rp')) return;
      e.preventDefault();
      if (action.type === 'help') setOpen('help');
      else if (action.type === 'search') setOpen('find');
      else if (action.type === 'go') { setOpen(null); nav(action.to); }
      else if (action.type === 'new') window.dispatchEvent(new CustomEvent('tgt:new'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);
  if (open === 'help') return <HelpOverlay onClose={() => setOpen(null)} />;
  if (open === 'find') return <Finder onClose={() => setOpen(null)} />;
  return null;
}

function Dialog({ label, onClose, children }) {
  return (
    <div className="kbd-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kbd-dialog" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}

function HelpOverlay({ onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 className="kbd-title">Keyboard shortcuts</h2>
        <button ref={ref} type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">Esc</button>
      </div>
      <table className="kbd-table" data-testid="shortcut-list">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.does}>
              <td>{s.keys.map((k, i) => <React.Fragment key={k}>{i > 0 && <span className="muted small"> then </span>}<kbd>{k}</kbd></React.Fragment>)}</td>
              <td>{s.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ margin: '10px 0 0' }}>On paper cards: <kbd>Tab</kbd> next hole, <kbd>Enter</kbd> next player, arrows to move.</p>
    </Dialog>
  );
}

function Finder({ onClose }) {
  const nav = useNavigate();
  const data = useData();
  const { status } = useSession();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const on = {
    feed: useFeature('feed'), comps: useFeature('side_comps'), planner: useFeature('planner'), trophies: useFeature('trophies'),
    tribunal: useFeature('tribunal'), cup: useFeature('cup'),
  };
  const items = useMemo(() => [
    { label: 'Trip status (on now or next)', to: '/', kind: 'Screen', words: ['trip', 'this trip', 'next trip', 'on now', 'home', 'status', 'today'] },
    { label: 'Leaderboard', to: '/leaderboard', kind: 'Screen', words: ['scores'] },
    on.planner && { label: 'Trips', to: '/plan', kind: 'Screen', words: ['organise', 'costs', 'votes', 'jobs', 'trip desk', 'desk'] },
    { label: 'Players table', to: '/group/players', kind: 'Screen', words: ['handicap', 'players & handicaps'] },
    { label: 'Paper cards', to: '/cards', kind: 'Screen', words: ['scorecard', 'enter scores'] },
    { label: 'Paste a scorecard', to: '/courses/paste', kind: 'Screen', words: ['course', 'par', 'index', 'course scorecards'] },
    { label: 'Present the leaderboard', to: '/present', kind: 'Screen', words: ['tv', 'big screen'] },
    on.feed && { label: 'Feed', to: '/feed', kind: 'Screen' },
    { label: 'What we’re playing for', to: '/comps-board', kind: 'Screen', words: ['comps', 'standings', 'side comps'] },
    on.cup && { label: 'The Cup', to: '/cup', kind: 'Screen' },
    on.trophies && { label: 'Trophy Room', to: '/trophies', kind: 'Screen' },
    { label: 'Governance', to: '/governance', kind: 'Screen', words: ['elections', 'how we decide'] },
    { label: 'Rulebook', to: '/governance/rulebook', kind: 'Screen' },
    on.tribunal && { label: 'Tribunal', to: '/governance/tribunal', kind: 'Screen' },
    { label: 'Committees', to: '/governance/committees', kind: 'Screen' },
    { label: 'Courses', to: '/courses', kind: 'Screen' },
    { label: 'Players & group', to: '/group', kind: 'Screen', words: ['handicaps', 'invites', 'group'] },
    status?.is_admin && { label: 'Admin', to: '/admin', kind: 'Screen' },
    { label: 'More', to: '/more', kind: 'Screen' },
    ...(data?.players || []).filter((p) => p.approved !== false).map((p) => ({ label: p.name, to: `/player/${p.id}`, kind: 'Player', words: [p.nickname].filter(Boolean) })),
  ].filter(Boolean), [data?.players, status?.is_admin, on.feed, on.comps, on.planner, on.trophies, on.tribunal, on.cup]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = findItems(items, q, 8);
  const go = (it) => { if (!it) return; onClose(); nav(it.to); };
  return (
    <Dialog label="Find a screen or a player" onClose={onClose}>
      <input className="input" autoFocus value={q} placeholder="Find a screen or a player…" aria-label="Find a screen or a player"
        onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); go(list[i]); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }} />
      <ul className="kbd-list" role="listbox" aria-label="Results">
        {list.map((it, n) => (
          <li key={it.to} role="option" aria-selected={n === i}>
            <button type="button" className={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => go(it)}>
              <span className="grow">{it.kind === 'Player' ? playerName(data.playersById[it.to.split('/')[2]]) : it.label}</span>
              <span className="small muted">{it.kind}</span>
            </button>
          </li>
        ))}
        {!list.length && <li className="small muted" style={{ padding: 10 }}>Nothing matches “{q}”.</li>}
      </ul>
    </Dialog>
  );
}
