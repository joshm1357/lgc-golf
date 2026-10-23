import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  needsSaved, isSaveSpotError, gateWords, gate, GATED_ACTIONS, CAN_ACTIONS, SAVE_MESSAGE, PHONE_ONLY_LABEL, PHONE_ONLY_HELP, FEATURE_KEY,
} from './savedgate.js';
import { FEATURE_BY_KEY, PRESETS } from './features.js';

const phoneOnly = { is_member: true, player_id: 'p1', signed_in: false, role: 'player' };
const saved = { ...phoneOnly, signed_in: true };

describe('the list (Josh, 23 Oct, option B)', () => {
  it('names every action that needs a saved account', () => {
    expect(Object.keys(GATED_ACTIONS).sort()).toEqual([
      'call_vote', 'club_claim', 'create_cup', 'dispute', 'fine', 'invite', 'money', 'organise', 'penalty',
      'propose_award', 'propose_rule', 'propose_trip', 'start_group',
    ]);
  });
  it('keeps looking and playing open', () => {
    expect(CAN_ACTIONS).toEqual(['look', 'rsvp', 'vote', 'score', 'post', 'react', 'comment', 'cap_tip', 'side_game_opt_in', 'claim_own']);
    for (const a of CAN_ACTIONS) expect(needsSaved(a, { status: phoneOnly })).toBe(false);
  });
  it('no action is on both lists', () => {
    for (const a of CAN_ACTIONS) expect(a in GATED_ACTIONS).toBe(false);
  });
});

describe('needsSaved', () => {
  it('phone-only in a group: every gated action asks', () => {
    for (const a of Object.keys(GATED_ACTIONS)) expect(needsSaved(a, { status: phoneOnly })).toBe(true);
  });
  it('a saved account never asks', () => {
    for (const a of Object.keys(GATED_ACTIONS)) expect(needsSaved(a, { status: saved })).toBe(false);
  });
  it('the group switched it off: only starting a group or a club claim still asks', () => {
    const asks = Object.keys(GATED_ACTIONS).filter((a) => needsSaved(a, { status: phoneOnly, limited: false }));
    expect(asks.sort()).toEqual(['club_claim', 'start_group']);
  });
  it('no way to sign in in this build: never asks (no dead end)', () => {
    expect(needsSaved('money', { status: phoneOnly, signInOn: false })).toBe(false);
    expect(needsSaved('start_group', { status: null, signInOn: false })).toBe(false);
  });
  it('quick rounds and an organiser viewing as a player never ask', () => {
    expect(needsSaved('money', { status: { ...phoneOnly, quick: true } })).toBe(false);
    expect(needsSaved('money', { status: { ...phoneOnly, viewing: true } })).toBe(false);
  });
  it('signed out (no group yet): starting a group or claiming a course asks; group things don’t', () => {
    expect(needsSaved('start_group', { status: null })).toBe(true);
    expect(needsSaved('club_claim', { status: null })).toBe(true);
    expect(needsSaved('money', { status: null })).toBe(false);
  });
  it('a phone-only organiser is asked too (organisers are always saved)', () => {
    expect(needsSaved('organise', { status: { ...phoneOnly, role: 'organiser', is_admin: true } })).toBe(true);
  });
  it('an unknown action never asks', () => {
    expect(needsSaved('dance', { status: phoneOnly })).toBe(false);
  });
});

describe('the database’s refusal opens the same sheet', () => {
  it('spots the message (and the hint)', () => {
    expect(isSaveSpotError(new Error(SAVE_MESSAGE))).toBe(true);
    expect(isSaveSpotError(SAVE_MESSAGE)).toBe(true);
    expect(isSaveSpotError({ message: 'x', hint: 'save_spot' })).toBe(true);
    expect(isSaveSpotError(new Error('new row violates row-level security policy'))).toBe(false);
    expect(isSaveSpotError(null)).toBe(false);
  });
  it('is word for word what migration 102 says', () => {
    const sql = fs.readFileSync(new URL('../../supabase/migrations/102_saved_accounts.sql', import.meta.url), 'utf8');
    expect(sql).toContain(`'${SAVE_MESSAGE}'`);
    expect(sql).toContain("using errcode = '42501', hint = 'save_spot'");
  });
});

describe('words and the button marker', () => {
  it('the phone-only option and its line (Josh, 23 Oct)', () => {
    expect(PHONE_ONLY_LABEL).toBe('Just this phone: scoring and voting only');
    expect(PHONE_ONLY_HELP).toBe('You can follow along, vote and score. To organise, pay or propose things, save your spot (Google or email).');
  });
  it('the sheet says what needs saving', () => {
    expect(gateWords('money')).toMatch(/^Money .* needs a saved account\./);
    expect(gateWords('nope')).toMatch(/^This needs a saved account/);
  });
  it('gate() marks a button', () => {
    expect(gate('propose_trip')).toEqual({ 'data-needs-saved': 'propose_trip' });
  });
});

describe('the switch', () => {
  it('is a group feature, on by default and in every preset', () => {
    expect(FEATURE_BY_KEY[FEATURE_KEY].newGroup).toBe(true);
    for (const p of PRESETS) expect(p.switches[FEATURE_KEY]).toBe(true);
  });
});
