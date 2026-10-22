import { describe, it, expect } from 'vitest';
import {
  DESTINATIONS, ORGANISE_TABS, caddieHidden, usesPanel, caddieContext, caddieSuggestions, caddieMode, fallbackIntro, sessionFlag,
  canUse, destinationPath, goButton, caddieIds, searchDestinations,
} from './caddie.js';
import * as fn from '../../supabase/functions/ai-helper/routes.ts';

const R = 'dddddddd-0000-4000-8000-000000000001';
const R2 = 'dddddddd-0000-4000-8000-000000000002';
const T = 'aaaaaaaa-0000-4000-8000-000000000001';
const P = 'bbbbbbbb-0000-4000-8000-000000000001';
const ME = '11111111-1111-4111-8111-111111111111';
const allOn = () => true;

describe('the catalogue', () => {
  it('matches the ai-helper function’s list exactly (keys, ids, organiser-only, features)', () => {
    const shape = (d) => ({ key: d.key, needs: d.needs, takes: d.takes, organiser: d.organiser, feature: d.feature });
    expect(DESTINATIONS.map(shape)).toEqual(fn.DESTINATIONS.map(shape));
    expect(ORGANISE_TABS).toEqual(fn.ORGANISE_TABS);
  });
  it('every place has a label, words and a link', () => {
    for (const d of DESTINATIONS) {
      expect(d.label && d.words.length).toBeTruthy();
      expect(destinationPath(d.key, { round: R, trip: T, plan: P, me: ME })).toMatch(/^\//);
    }
  });
  it('builds links, and refuses ones missing an id they need', () => {
    expect(destinationPath('leaderboard', {})).toBe('/leaderboard');
    expect(destinationPath('trip_now', {})).toBe('/'); // ov15: This trip
    expect(destinationPath('leaderboard', { round: R })).toBe(`/?r=${R}`);
    expect(destinationPath('admin_teams', { round: R })).toBe(`/admin?round=${R}`);
    expect(destinationPath('admin_teams', {})).toBe(null);
    expect(destinationPath('score', { round: 'not-an-id' })).toBe(null);
    expect(destinationPath('trip_organise', { plan: P, tab: 'kitty' })).toBe(`/plan/${P}?view=organise&tab=kitty`);
    expect(destinationPath('trip_organise', { plan: P, tab: 'evil' })).toBe(`/plan/${P}?view=organise`);
    expect(destinationPath('profile', { me: ME })).toBe(`/player/${ME}`);
    expect(destinationPath('nowhere', {})).toBe(null);
  });
});

describe('where it shows and what screen you’re on', () => {
  it('hides on full-screen views only', () => {
    for (const p of ['/tv/lgc', '/replay/x', '/round/x/present', '/round/x/print', '/present', '/desk/present/x', '/desk/print/x', '/start', '/join/abc', '/score/x', '/ask']) expect(caddieHidden(p)).toBe(true);
    for (const p of ['/', '/plan', '/rules', '/admin', '/desk', '/group/players', '/courses/paste', '/round/x/cards', '/cards', '/more', '/trip/x']) expect(caddieHidden(p)).toBe(false);
  });
  it('is a panel on a laptop and on the laptop tools', () => {
    expect(usesPanel('/', 375)).toBe(false);
    expect(usesPanel('/', 1280)).toBe(true);
    expect(usesPanel('/desk/players', 375)).toBe(true);
    for (const p of ['/group/players', '/courses/paste', '/cards', '/round/x/cards']) expect(usesPanel(p, 375)).toBe(true);
    for (const p of ['/group', '/courses', '/plan/x']) expect(usesPanel(p, 375)).toBe(false);
  });
  it('route → context', () => {
    expect(caddieContext('/', '', { round: R })).toEqual({ screen: 'trip_now', round_id: R });
    expect(caddieContext('/leaderboard', '', { round: R })).toEqual({ screen: 'leaderboard', round_id: R });
    expect(caddieContext('/', `?r=${R2}`, { round: R })).toEqual({ screen: 'leaderboard', round_id: R2 });
    expect(caddieContext('/score/' + R)).toEqual({ screen: 'score', round_id: R });
    expect(caddieContext(`/round/${R}/cards`)).toEqual({ screen: 'leaderboard', round_id: R });
    expect(caddieContext('/cards', '', { round: R2 })).toEqual({ screen: 'leaderboard', round_id: R2 });
    expect(caddieContext(`/plan/${P}`, '?view=organise&tab=kitty')).toEqual({ screen: 'plan', plan_id: P, view: 'organise', tab: 'kitty' });
    expect(caddieContext('/plan')).toEqual({ screen: 'trips' });
    expect(caddieContext(`/trip/${T}`)).toEqual({ screen: 'trip', trip_id: T });
    expect(caddieContext('/rules')).toEqual({ screen: 'rulebook' });
    expect(caddieContext('/comps-board')).toEqual({ screen: 'comps_board' });
    expect(caddieContext('/admin', `?round=${R}`)).toEqual({ screen: 'admin', round_id: R });
    expect(caddieContext('/history')).toEqual({ screen: 'history' });
    expect(caddieContext('/games', `?r=${R}`)).toEqual({ screen: 'games', round_id: R });
    expect(caddieContext('/games', '?r=<script>')).toEqual({ screen: 'games' });
    expect(caddieContext('/somewhere-else')).toEqual({ screen: 'other' });
  });
  it('three suggestions per screen; the leaderboard’s are about its round', () => {
    const lb = caddieSuggestions({ screen: 'leaderboard' }, { roundName: 'Wednesday — Kurri' });
    expect(lb).toHaveLength(3);
    expect(lb[0]).toBe('Who’s leading in Wednesday — Kurri?');
    expect(caddieSuggestions({ screen: 'leaderboard' }, { isAdmin: true })[2]).toBe('Change the teams');
    for (const s of ['score', 'games', 'cup', 'rulebook', 'admin', 'plan', 'history', 'group', 'other']) expect(caddieSuggestions({ screen: s })).toHaveLength(3);
  });
});

describe('can the AI answer here?', () => {
  it('yes when nothing stops it', () => {
    expect(caddieMode({})).toEqual({ ai: true, reason: null, text: '' });
  });
  it('the reasons, in order', () => {
    expect(caddieMode({ featureOn: false }).reason).toBe('off');
    expect(caddieMode({ notSetUp: true }).reason).toBe('not_set_up');
    expect(caddieMode({ offline: true }).reason).toBe('offline');
    expect(caddieMode({ capped: true }).reason).toBe('capped');
    expect(caddieMode({ guest: true, featureOn: false }).reason).toBe('guest');
    expect(caddieMode({ quick: true, guest: true }).reason).toBe('quick');
    expect(caddieMode({ viewing: true, offline: true }).reason).toBe('viewing');
  });
  it('says it plainly, and still offers to take you there', () => {
    expect(fallbackIntro(caddieMode({ notSetUp: true }))).toBe('I can’t answer questions yet — the AI isn’t switched on for your group — but I can take you to the right page:');
    expect(fallbackIntro(caddieMode({ offline: true }))).toMatch(/^I can’t answer questions right now — there’s no signal — but I can take you/);
    expect(fallbackIntro(caddieMode({}))).toBe('');
  });
  it('remembers “not set up” and “capped” from the function’s reply', () => {
    expect(sessionFlag({ kind: 'error', text: 'The AI helper isn’t switched on yet' })).toBe('not_set_up');
    expect(sessionFlag({ kind: 'error', text: 'Used all 60', capped: true })).toBe('capped');
    expect(sessionFlag({ kind: 'answer', text: 'hi' })).toBe(null);
    expect(sessionFlag({ kind: 'error', text: 'No signal' })).toBe(null);
  });
});

describe('organiser-only and switched-off places', () => {
  it('players and guests never see organiser places', () => {
    const teams = DESTINATIONS.find((d) => d.key === 'admin_teams');
    expect(canUse(teams, { isAdmin: false })).toBe(false);
    expect(canUse(teams, { isAdmin: true })).toBe(true);
    expect(goButton({ key: 'admin_teams', round: R }, { isAdmin: false })).toBe(null);
    expect(goButton({ key: 'admin_teams', round: R }, { isAdmin: true })).toEqual({ key: 'admin_teams', label: 'Teams & pairs', path: `/admin?round=${R}` });
    expect(searchDestinations('teams', { isAdmin: false, ids: { round: R } }).some((r) => r.key === 'admin_teams')).toBe(false);
  });
  it('switched-off features are left out', () => {
    const off = (k) => k !== 'cup';
    expect(searchDestinations('cup', { featureOn: off })).toEqual([]);
    expect(goButton({ key: 'cup' }, { featureOn: off })).toBe(null);
    expect(goButton({ key: 'made_up' }, {})).toBe(null);
  });
});

describe('the search (no AI needed)', () => {
  const ids = { round: R, plan: P, trip: T, me: ME };
  const top = (q, isAdmin = true) => searchDestinations(q, { isAdmin, featureOn: allOn, ids })[0];
  it('teams, ambrose teams, pairs → the teams for the current round', () => {
    for (const q of ['teams', 'ambrose teams', 'How do I change the pairs?']) expect(top(q)).toEqual({ key: 'admin_teams', label: 'Teams & pairs', path: `/admin?round=${R}` });
  });
  it('rules, gimme → the Rulebook', () => {
    expect(top('rules').key).toBe('rulebook');
    expect(top('Is a gimme allowed?').key).toBe('rulebook');
  });
  it('notifications → notification settings', () => {
    expect(top('turn on notifications')).toEqual({ key: 'notifications', label: 'Notifications', path: '/notifications' });
  });
  it('money, kitty → the trip’s kitty', () => {
    expect(top('money')).toEqual({ key: 'trip_organise', label: 'Organise the trip › Kitty', path: `/plan/${P}?view=organise&tab=kitty` });
    expect(top('Where do I pay the kitty?', false).path).toBe(`/plan/${P}?view=organise&tab=kitty`);
  });
  it('more', () => {
    expect(top('Where do I enter my score?', false).key).toBe('score');
    expect(top('Who’s leading?', false).path).toBe(`/?r=${R}`);
    expect(top('propose a rule').key).toBe('propose_rule');
    expect(top('my profile photo').key).toBe('profile');
    expect(top('Who pays who?').key).toBe('games');
  });
  it('nothing for nonsense; places needing an id it hasn’t got are skipped', () => {
    expect(searchDestinations('xyzzy', { ids })).toEqual([]);
    expect(searchDestinations('', { ids })).toEqual([]);
    expect(searchDestinations('kitty', { ids: {} })).toEqual([]);
  });
});

describe('ids when the question doesn’t say', () => {
  const rounds = [
    { id: R, play_date: '2026-10-21', status: 'locked' },
    { id: R2, play_date: '2026-10-23', status: 'setup' },
  ];
  it('the screen’s first, else live, else the next round', () => {
    expect(caddieIds({ round_id: R }, { rounds })).toMatchObject({ round: R });
    expect(caddieIds({}, { rounds, liveRound: { id: R } })).toMatchObject({ round: R });
    expect(caddieIds({}, { rounds, today: '2026-10-22' })).toMatchObject({ round: R2 });
    expect(caddieIds({ plan_id: P }, { plan: { id: 'x' }, currentTrip: { id: T }, me: ME })).toEqual({ plan: P, trip: T, me: ME });
  });
});
