// Where to stay — accommodation ideas and search links, in the trip builder's step 2 "Courses & stays" (ov23, Josh:
// "Accommodation search links/ideas don't belong in step 1"). Once the area's chosen: the search links for the places
// to stay on the table and the primary / backup weekends, with the trip's real head count ("for 9 people · 5+
// bedrooms" — change it here and the trip keeps it), and the ideas and shared lists saved so far.
import React from 'react';
import { supabase } from '../lib/supabase.js';
import { Icon } from './ui.jsx';
import { useRun, must } from '../lib/run.js';
import StaySearch from './StaySearch.jsx';

export default function StayIdeas({ plan, st, save, org, accom = [], reloadAccom, head = { people: 0, words: null } }) {
  const [busy, run] = useRun();
  const area = st.region;
  if (!area) return null;
  const ideas = accom.filter((a) => a.area === area || !a.area);
  const places = (st.stays?.length ? st.stays.map((s) => s.name) : [area]).slice(0, 3);
  const removeIdea = (a) => run(async () => { await must(supabase.from('plan_stays').delete().eq('id', a.id)); reloadAccom?.(); });
  const addIdea = (row) => run(async () => {
    await must(supabase.from('plan_stays').insert({ plan_id: plan.id, ...row, area }));
    reloadAccom?.();
  }, row.is_list ? 'List added — it goes on the vote with a View places link' : 'Added');
  const setPeople = (n) => { if (org && n > 0 && n < 200) save({ ...st, headcount: n, headcountBy: 'organiser' }); };
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="stay-ideas">
      <strong>🏡 Where to stay — {area}</strong>
      {ideas.length === 0 && <span className="small muted">No ideas yet — search below, save a few to a list on the site and paste its link, or paste a place.</span>}
      {ideas.map((a) => (
        <div key={a.id} className="row between small" style={{ gap: 6 }} data-testid="accom-idea">
          <span className="grow"><strong>{a.is_list ? '📋 ' : '🏡 '}{a.name}</strong>{a.link && <> · <a href={a.link} target="_blank" rel="noreferrer noopener">{a.is_list ? 'View places ↗' : 'Have a look ↗'}</a></>}{a.option_id ? ' · on the vote' : ''}</span>
          {org && !a.option_id && <button type="button" className="btn ghost sm" aria-label={`Remove ${a.name}`} disabled={busy} onClick={() => removeIdea(a)}>{Icon.x(14)}</button>}
        </div>
      ))}
      <StaySearch places={places} weekends={st.weekends || []} roles={!!st.weekendsSettled} people={head.people} peopleWords={head.words}
        busy={busy} onSave={org ? addIdea : null} onPeople={org ? setPeople : null} />
    </div>
  );
}
