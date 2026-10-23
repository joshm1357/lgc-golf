// "Your weekend" (R1, Josh 23 Oct 2026 — walkthrough review option A): the card at the top of a locked-in trip's page,
// for every player. What a quiet player opens the trip for, in one scroll:
//   📅 dates · countdown       📍 where we're staying (tap for maps)
//   each day: the course, your tee time and your group      🚗 your car      💰 paid and owed (the money line)
//   🎟️ Seats confirmed: 6 of 10 (paid)  (I7, when the trip asks for a deposit)
// A guest (R2) gets the same card headed "You're Josh's guest for the L.G.C long weekend".
//
// The "Your round" slot: W3 is building src/components/YourRound.jsx (your team, group, opponents, tee time). When
// that file exists its default export is shown for each of your rounds, in place of the tee time line here; until
// then the tee time and group come from tee_groups. Props it gets: { round, course, teeGroup, plan, trip, me }.
// The words are in lib/yourweekend.js.
import React, { useMemo } from 'react';
import { useData } from '../lib/store.jsx';
import { AvatarStack } from './ui.jsx';
import { fmtRange } from '../lib/plan.js';
import { stayAddress, toGoWords, weekendDays, teeLine, carWords, guestHeading } from '../lib/yourweekend.js';
import { seatsLine } from '../lib/money.js';
import { MoneyLine } from './MoneyLine.jsx';

// W3's YourRound, if it's in the app yet (an empty object until then — nothing breaks either way).
const ROUND_SLOT = import.meta.glob('./YourRound.jsx', { eager: true });
export const YourRoundSlot = Object.values(ROUND_SLOT)[0]?.default || null;

/**
 * pd: the plan's data; cars / rooms: lib/runup.js carsView / roomsView; tees: the trip's tee_groups;
 * guest: the guest view (R2); onMore(section): open "More about this trip" at a section ('cars').
 * yourRound: a component to show for each of my rounds (defaults to W3's YourRound when it exists).
 */
export function YourWeekend({ pd, trip = null, rounds = [], tees = [], cars = null, me = null, guest = false, onMore = null, yourRound = YourRoundSlot }) {
  const data = useData();
  const plan = pd.plan;
  const where = stayAddress(plan, pd.items);
  const days = useMemo(() => weekendDays({ rounds, coursesById: data.coursesById, tees, me, playersById: data.playersById }),
    [rounds, data.coursesById, tees, me, data.playersById]);
  const togo = toGoWords(plan.start_date);
  const car = carWords(cars, me, data.playersById);
  const seats = seatsLine({ plan, rsvps: pd.rsvps, transfers: pd.transfers, payments: pd.payments });
  const ins = pd.rsvps.filter((r) => r.status === 'in').map((r) => data.playersById[r.player_id]).filter(Boolean);
  const organiser = data.playersById[plan.organiser_id || plan.created_by];
  const Round = yourRound;
  return (
    <section className="yw card" data-testid="your-weekend" aria-label={guest ? 'Your trip' : 'Your weekend'}>
      <header className="yw-head">
        <div className="yw-tag">{guest ? '👋 WELCOME' : '⛳ YOUR WEEKEND'}</div>
        {guest && <div className="yw-guest" data-testid="guest-heading">{guestHeading(plan, organiser)}</div>}
        <div className="yw-when" data-testid="runup-countdown">
          <span>📅 {plan.start_date ? fmtRange(plan.start_date, plan.end_date) : 'Dates to come'}</span>
          {togo && <span className="yw-togo">{togo}</span>}
        </div>
        {where && (
          <a className="yw-where" href={where.maps} target="_blank" rel="noreferrer" data-testid="yw-address">
            📍 <span>{where.text}</span><span className="yw-maps">Maps ↗</span>
          </a>
        )}
      </header>

      <div className="yw-body">
        {days.length > 0 ? days.map((d) => (
          <div key={d.date || 'tbc'} className="yw-day" data-testid="yw-day">
            <div className="yw-day-label">{d.label}</div>
            {d.rounds.map((r) => (
              <div key={r.round.id} className="yw-round">
                <div className="yw-course"><strong>{r.courseName}</strong>{r.format ? <span className="muted"> · {r.format}</span> : null}</div>
                {Round
                  ? <Round round={r.round} course={r.course} teeGroup={r.teeGroup} plan={plan} trip={trip} me={me} />
                  : <div className="small" data-testid="yw-tee">{teeLine(r) ? <>🕖 {teeLine(r)}</> : <span className="muted">Tee time and group to come</span>}</div>}
              </div>
            ))}
          </div>
        )) : <div className="small muted">The rounds show here once they’re set up.</div>}

        <div className="yw-row" data-testid="yw-car">
          <span aria-hidden="true">🚗</span>
          <span className="grow">{car || <span className="muted">No car sorted yet</span>}</span>
          {!car && onMore && !guest && <button type="button" className="linkish small" onClick={() => onMore('cars')}>Sort a lift</button>}
        </div>

        <MoneyLine pd={pd} compact />

        {(seats || ins.length > 0) && (
          <div className="yw-row" data-testid="yw-seats">
            <AvatarStack players={ins} size={24} />
            <span className="small grow">{seats ? seats.line : `${ins.length} in`}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default YourWeekend;
