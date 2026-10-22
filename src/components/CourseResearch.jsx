// "About this course for groups" (088, ov17): Josh's course research on the course page (#/c/<slug>) and in the trip
// builder. Read straight from course_research (anyone signed in can read it; it's shared reference data, never a
// group's). With no sign-in, or before 088 is on a database, nothing shows — the screens work as before.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { aboutLines, checkedLabel, contactLinks, safeUrl } from '../lib/courseresearch.js';

const COLS = 'library_id,name,town,state,region,holes,par,fee_weekday,fee_weekend,cart_required,access_type,good_for_groups,drive_from_sydney_hours,booking_url,group_enquiry_url,website,phone,email,details,sources,last_checked';

/** Research rows for these library courses: { [library_id]: row }. */
export function useCourseResearch(ids) {
  const key = [...new Set((ids || []).filter(Boolean))].sort().join(',');
  const [rows, setRows] = useState({});
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data, error } = await supabase.from('course_research').select(COLS).in('library_id', key.split(','));
      if (!live || error) return;
      const m = {};
      for (const r of data || []) if (!m[r.library_id]) m[r.library_id] = r;
      setRows((cur) => ({ ...cur, ...m }));
    })().catch(() => {});
    return () => { live = false; };
  }, [key]);
  return rows;
}

/** The block. `r` is a course_research row (or pass libraryId and it loads its own). */
export function AboutForGroups({ r: given, libraryId, title = 'About this course for groups' }) {
  const loaded = useCourseResearch(given ? [] : [libraryId]);
  const r = given || loaded[libraryId];
  const [showSources, setShowSources] = useState(false);
  if (!r) return null;
  const lines = aboutLines(r);
  const c = contactLinks(r);
  const sources = (r.sources || []).map(safeUrl).filter(Boolean);
  return (
    <div className="card pad stack" style={{ gap: 6 }} data-testid="about-groups">
      <strong>{title}</strong>
      {lines.map((x) => (
        <div key={x.label} className="small" data-testid="about-line">
          <span style={{ fontWeight: 700 }}>{x.label}: </span>{x.value}
        </div>
      ))}
      {(c.booking || c.enquiry || c.tel || c.email) && (
        <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }} data-testid="about-links">
          {c.booking && <a href={c.booking} target="_blank" rel="noopener noreferrer">Book online ↗</a>}
          {c.enquiry && <a href={c.enquiry} target="_blank" rel="noopener noreferrer">Group enquiry ↗</a>}
          {c.tel && <a href={`tel:${c.tel}`}>📞 {c.phone}</a>}
          {c.email && <a href={`mailto:${c.email}`}>✉️ {c.email}</a>}
        </div>
      )}
      <span className="small muted" data-testid="about-checked">{checkedLabel(r)}</span>
      {sources.length > 0 && (
        showSources
          ? (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, overflowWrap: 'anywhere' }} data-testid="about-sources">
              {sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</a></li>)}
            </ul>
          )
          : <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowSources(true)} data-testid="about-sources-btn">Sources ({sources.length})</button>
      )}
    </div>
  );
}
