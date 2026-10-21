// Small ways into the course guide (screens/CourseGuide.jsx), each hidden when GPS is switched off for the group.
import React from 'react';
import { Link } from 'react-router-dom';
import { useFeature, useSession } from '../lib/store.jsx';
import { mappingProgress } from '../lib/courseguide.js';

const to = (course, hole, round) => `/guide/${course.id}${hole ? `/${hole}` : ''}${round ? `?r=${round.id}` : ''}`;

/** A chip under the leaderboard's round chips: the guide for this round's course. */
export function CourseGuideChip({ course, round }) {
  const gps = useFeature('gps');
  const { status } = useSession() || {};
  if (!gps || !course) return null;
  // No greens mapped: players would land on an empty guide, so only organisers see it (to map them) (review).
  const mapped = mappingProgress(course.holes || []).mapped;
  if (!mapped && !status?.is_admin) return null;
  return (
    <div style={{ padding: '8px 16px 0' }}>
      <Link to={to(course, null, round)} className="chip" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' }}>{mapped ? '📍 Course guide' : '📍 Map this course’s greens'}</Link>
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
