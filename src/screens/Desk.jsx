// Old /desk… addresses (Stage 11c's Trip desk, folded into Trips on 22 Oct). Bookmarks, posts and notifications
// that point here still work: each one forwards to the tool's new home (lib/desk.js deskForward).
//   /desk, /desk/trip/:planId   → Trips → the trip → Organise (the trip that matters now, or Trips if there's none)
//   /desk/players               → Group & invites → Players table   (/group/players)
//   /desk/courses               → Courses → Paste a scorecard        (/courses/paste)
//   /desk/cards, /desk/card/:id → paper cards                        (/cards, /round/:id/cards)
//   /desk/present/:id, /desk/print/:id → the round's Present and Print (/round/:id/present, /round/:id/print)
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useData, useFeature } from '../lib/store.jsx';
import { Loading } from '../components/ui.jsx';
import { deskForward, pickDeskPlan, TOOL } from '../lib/desk.js';

export default function DeskForward() {
  const { pathname } = useLocation();
  const to = deskForward(pathname);
  if (to) return <Navigate to={to} replace />;
  return <ToCurrentTrip />;
}

function ToCurrentTrip() {
  const planner = useFeature('planner');
  const data = useData();
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    if (!planner) return;
    supabase.from('plans').select('*').order('created_at', { ascending: false })
      .then(({ data: rows, error }) => setPlans(error ? [] : rows || []), () => setPlans([]));
  }, [planner]);
  if (!planner) return <Navigate to="/" replace />;
  if (!plans) return <Loading />;
  const plan = pickDeskPlan(plans, data.trips);
  return <Navigate to={plan ? TOOL.organise(plan.id) : '/plan'} replace />;
}
