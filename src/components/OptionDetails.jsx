// Details for an option on a vote card (ov23, Josh 08:37: "In the vote cards you need to have the course details on
// overview and some summary on the card"). Every option already carries its one-line summary (plan_options.notes,
// worked out when the vote was called). This adds the full details behind a small "ⓘ Details" button — a bottom
// sheet on a phone, the same sheet in the middle on a laptop — and a hover tooltip on a laptop. Tapping it never
// casts a vote (the vote buttons are separate and big).
//
// Which course / area / place an option is comes from the trip builder's saved option keys (trip_builds.state
// .optionKeys: option id → 'areacourse:<area>:<library id>', 'area:<name>', 'stay:<key>'). One small read per trip.
// The sheet goes through openOptionDetails() so it can be swapped for the maps' course sheet (ov22) in one place.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useRealtime } from '../lib/store.jsx';
import { Sheet } from './ui.jsx';
import { AboutForGroups } from './CourseResearch.jsx';
import { CourseSheet, StaySheet } from './PlaceSheets.jsx';

/** What an option is, from its key → { kind: 'course' | 'area' | 'stay' | 'weekend' | 'other', id?, name?, area? } */
export function optionTarget(key) {
  const k = String(key || '');
  let m = /^areacourse:(.+):([0-9a-f-]{36})$/i.exec(k);
  if (m) return { kind: 'course', area: m[1], id: m[2] };
  m = /^course:\d+:([0-9a-f-]{36})$/i.exec(k);
  if (m) return { kind: 'course', id: m[1] };
  m = /^area:(.+)$/.exec(k);
  if (m) return { kind: 'area', name: m[1] };
  m = /^stay:(.+)$/.exec(k);
  if (m) return { kind: 'stay', key: m[1] };
  if (k.startsWith('weekend:')) return { kind: 'weekend' };
  return k ? { kind: 'other' } : null;
}

/** The builder's option keys for a trip (option id → key) and its saved courses / places, live. */
export function useOptionKeys(planId) {
  const [st, setSt] = useState(null);
  const load = useCallback(async () => {
    if (!planId) return;
    const { data, error } = await supabase.from('trip_builds').select('state').eq('plan_id', planId).maybeSingle();
    if (!error) setSt(data?.state || null);
  }, [planId]);
  useEffect(() => { load(); }, [load]);
  useRealtime(['trip_builds'], load);
  return st;
}

/** For one option: what it is (or null when there's nothing more to show). */
export function detailsFor(o, st) {
  const key = st?.optionKeys?.[o?.id];
  const t = optionTarget(key);
  if (!t || t.kind === 'weekend' || t.kind === 'other') return null;
  if (t.kind === 'course') return { ...t, course: st.courses?.[t.id] || null };
  if (t.kind === 'area') return { ...t, courses: (st.areaCourses?.[t.name] || []).map((id) => st.courses?.[id]?.name).filter(Boolean), stays: (st.areaStays?.[t.name] || []).map((s) => s.name) };
  if (t.kind === 'stay') {
    const all = Object.entries(st.areaStays || {}).flatMap(([area, list]) => list.map((s) => ({ ...s, area })));
    return { ...t, stay: all.find((s) => (s.key || s.name) === t.key) || (st.stays || []).find((s) => (s.key || s.name) === t.key) || null };
  }
  return null;
}

/** The "ⓘ Details" button (and, on a laptop, the hover tooltip is the summary line on the row's title). */
export function DetailsButton({ onClick, label }) {
  return (
    <button type="button" className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={`Details: ${label}`}
      data-testid="option-details" style={{ minHeight: 32, padding: '2px 10px', fontSize: 13, flex: 'none' }}>ⓘ Details</button>
  );
}

/** The sheet: the same course / place-to-stay sheets as the planning maps (ov22 PlaceSheets) — one sheet everywhere.
 *  Read-only here (no "on the table" button): voting is on the card. Areas get a short summary of their own. */
export function OptionDetailsSheet({ option, detail, onClose, st = null }) {
  if (!option || !detail) return null;
  const known = Object.values(st?.courses || {});
  if (detail.kind === 'course' && detail.course) {
    return <CourseSheet id={detail.id} course={detail.course} org={false} aiOn={false} onClose={onClose} />;
  }
  if (detail.kind === 'stay' && detail.stay?.lat != null) {
    return <StaySheet stay={detail.stay} courses={known} stayMax={st?.stayMax} onClose={onClose} />;
  }
  return (
    <Sheet title={option.label} onClose={onClose}>
      <div className="stack" style={{ gap: 8 }} data-testid="option-details-sheet">
        {option.notes && <div className="small" data-testid="option-summary">{option.notes}</div>}
        {detail.kind === 'course' && (
          <>
            {detail.area && <div className="small muted">In {detail.area}{detail.course?.area ? ` · ${detail.course.area}` : ''}</div>}
            <AboutForGroups libraryId={detail.id} />
          </>
        )}
        {detail.kind === 'area' && (
          <div className="card pad stack" style={{ gap: 4 }}>
            <div className="small"><strong>⛳ Courses on the table:</strong> {detail.courses.join(', ') || 'none yet'}</div>
            <div className="small"><strong>🏠 Places to stay:</strong> {detail.stays.join(', ') || 'none yet'}</div>
          </div>
        )}
        {detail.kind === 'stay' && (
          <div className="card pad stack" style={{ gap: 4 }}>
            <div className="small"><strong>🏠 {detail.stay?.name || option.label}</strong>{detail.stay?.area ? ` · ${detail.stay.area}` : ''}</div>
            {detail.stay?.custom && <div className="small muted">A spot the organiser dropped on the map.</div>}
          </div>
        )}
        <button type="button" className="btn ghost block" onClick={onClose}>Back to the vote</button>
      </div>
    </Sheet>
  );
}
