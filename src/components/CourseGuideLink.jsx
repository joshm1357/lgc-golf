// Small ways into the course guide (screens/CourseGuide.jsx), each hidden when GPS is switched off for the group.
import React from 'react';
import { Link } from 'react-router-dom';
import { useFeature } from '../lib/store.jsx';

const to = (course, hole, round) => `/guide/${course.id}${hole ? `/${hole}` : ''}${round ? `?r=${round.id}` : ''}`;

/** A chip under the leaderboard's round chips: the guide for this round's course. */
export function CourseGuideChip({ course, round }) {
  if (!useFeature('gps') || !course) return null;
  return (
    <div style={{ padding: '8px 16px 0' }}>
      <Link to={to(course, null, round)} className="chip" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>📍 Course guide</Link>
    </div>
  );
}

/** A full-width button (the Courses list). */
export function CourseGuideButton({ course, onClick }) {
  if (!useFeature('gps') || !course) return null;
  return <Link to={to(course)} className="btn ghost block" onClick={onClick}>📍 Course guide — every hole on the map</Link>;
}

/** A small text link (the distances box on the score screen). */
export function CourseGuideHoleLink({ course, hole, round }) {
  if (!useFeature('gps') || !course) return null;
  return <Link to={to(course, hole?.n, round)} className="small" style={{ fontWeight: 700 }}>Hole {hole?.n} in the course guide →</Link>;
}
