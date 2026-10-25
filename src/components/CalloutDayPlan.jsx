// A one-day round's day, roughly (ov40): for each time on offer — or the locked one — when you'd leave home, tee off,
// be in, and how that sits against dusk. Uses the course's place (the shared course library) and, if you've set it on
// your profile, your own home suburb (never anyone else's). Everything is "about".
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useData } from '../lib/store.jsx';
import DayTimeline from './DayTimeline.jsx';
import { calloutTimes } from '../lib/dayplan.js';
import { driveBetween, dayLabel } from '../lib/tripbuilder.js';

export default function CalloutDayPlan({ plan, options = [], players = 4, me = null }) {
  const data = useData();
  const [place, setPlace] = useState(null);
  const [home, setHome] = useState(null);
  const libId = plan.library_course_id || data.coursesById?.[plan.course_id]?.library_id || null;
  useEffect(() => {
    if (!libId) return;
    supabase.rpc('library_course', { p_id: libId }).then(({ data: c }) => setPlace(c?.lat != null ? { lat: c.lat, lng: c.lng } : null), () => {});
  }, [libId]);
  useEffect(() => {
    if (!me) return;
    supabase.from('player_home_areas').select('lat,lng,label').eq('player_id', me).maybeSingle().then(({ data: h }) => setHome(h || null), () => {});
  }, [me]);
  const times = useMemo(() => calloutTimes({ plan, options, place, players, homeDrive: home && place ? driveBetween(home, place) : null }), [plan, options, place, players, home]);
  if (!times.length) return null;
  const main = times.find((t) => t.blocks) || null;
  return (
    <div className="card pad stack" style={{ gap: 8 }} data-testid="co-day-plan">
      <strong>🕒 The day, roughly</strong>
      {times.map((t) => (
        <div key={t.key} className="small" data-testid="co-day-time">
          {times.length > 1 || t.label ? <strong>{t.label || dayLabel(t.date)}: </strong> : null}{t.line}
        </div>
      ))}
      {main && <DayTimeline compact blocks={main.blocks} sun={main.sun} from={5 * 60} to={21 * 60} testid="co-day-timeline" />}
      <span className="small muted">About 4 h 30 a 4-ball{place ? '' : ' · dusk shows once the course is set'}{home ? ` · drive from ${home.label}` : ''}. Every time is about.</span>
    </div>
  );
}
