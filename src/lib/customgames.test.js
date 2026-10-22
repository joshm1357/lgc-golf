import { describe, it, expect } from 'vitest';
import { copyFrom, customProblems, customRow, roundGameFromCustom, withCustom, customSummary, cleanCustomSettings } from './customgames.js';
import { settingsProblems, splitOptions, gameLabel, playGame } from './games.js';

describe('custom games', () => {
  it('copy and change starts from the standard game’s options and stake', () => {
    const c = copyFrom('skins');
    expect(c).toEqual({ name: 'Skins — our way', base_type: 'skins', settings: { net: true, carry: true, validate: false, stake: 5 }, rules_text: '' });
    const fromRound = copyFrom('nassau', { kind: 'nassau', stake: 20, options: { net: false, scoring: 'stroke' }, settings: { press: 2 } });
    expect(fromRound.settings).toMatchObject({ net: false, press: 2, stake: 20, front: null });
  });

  it('is only custom with a house rule; settings must be the base game’s standard options', () => {
    const c = { ...copyFrom('skins'), settings: { net: true, carry: false, stake: 5 } };
    expect(customProblems(c)).toEqual([expect.stringMatching(/house rule/)]);
    expect(customProblems({ ...c, rules_text: 'Loser of each skin shouts a beer' })).toEqual([]);
    expect(customProblems({ ...c, rules_text: 'x'.repeat(5), settings: { scoring: 'stroke' } })[0]).toMatch(/scoring isn’t an option/);
    expect(customProblems({ ...c, rules_text: 'house', settings: { carry: 'yes' } })[0]).toMatch(/isn’t one of the choices/);
    expect(customProblems({ ...c, rules_text: 'house', settings: { stake: 5000 } })[0]).toMatch(/stake/);
    expect(customProblems({ ...c, rules_text: 'house', name: 'x' })[0]).toMatch(/name/);
    expect(customProblems({ ...c, rules_text: 'house', base_type: 'darts' })).toContain('Pick the game it’s based on');
    expect(customProblems({ base_type: 'nassau', name: 'Big Nassau', rules_text: 'Presses double', settings: { press: 2, front: 5, back: null, scoring: 'stableford' } })).toEqual([]);
  });

  it('becomes a round game row that passes the database checks, and plays with its options', () => {
    const custom = { id: 'cg1', ...customRow({ name: ' Beer skins ', base_type: 'skins', settings: { net: false, carry: false, stake: 2 }, rules_text: ' Loser shouts ' }) };
    expect(custom.name).toBe('Beer skins');
    const row = roundGameFromCustom(custom, 'r1');
    expect(row).toEqual({ round_id: 'r1', kind: 'skins', stake: 2, options: { net: false, carry: false }, settings: { validate: false }, custom_game_id: 'cg1' });
    expect(settingsProblems('skins', row.settings)).toEqual([]);
    const game = withCustom({ id: 'g1', ...row }, { cg1: custom });
    expect(game.name).toBe('Beer skins');
    expect(game.house_rules).toBe('Loser shouts');
    expect(gameLabel(game)).toBe('Beer skins $2 (gross, no carry-overs)');
    // The maths is the base game's: carry-overs off means a tie kills the skin.
    const holes = [{ n: 1, par: 4, si: 1 }, { n: 2, par: 4, si: 2 }];
    const scores = { a: { 1: { strokes: 4 }, 2: { strokes: 3 } }, b: { 1: { strokes: 4 }, 2: { strokes: 4 } } };
    const p = playGame(game, { round: { id: 'r1', format: 'stableford', status: 'live' }, course: { holes }, scoresIdx: { r1: scores }, roundPlayers: [{ player_id: 'a', playing_handicap: 0 }, { player_id: 'b', playing_handicap: 0 }], playersById: {} });
    expect(p.result.holes.map((h) => h.status)).toEqual(['tied', 'won']);
    expect(p.result.holes[1].value).toBe(1);
    expect(p.money).toEqual({ a: 200, b: -200 });
    expect(withCustom({ kind: 'skins' }, {})).toEqual({ kind: 'skins' });
  });

  it('describes itself in words', () => {
    expect(customSummary({ base_type: 'skins', settings: { carry: false, validate: true, stake: 5 } })).toBe('Based on Skins: Net (with handicaps), No carry-overs, Validated skins · stake $5');
    expect(cleanCustomSettings('birdie_pool', { stake: 'x' }).stake).toBe(2);
  });
});

describe('standard game options (073)', () => {
  it('split into the old options column and the new settings column', () => {
    expect(splitOptions('nassau', { net: false, press: 3, front: 5 })).toEqual({ options: { net: false, scoring: 'stroke' }, settings: { front: 5, back: null, total: null, press: 3 } });
    expect(splitOptions('stableford_pot', { net: false })).toEqual({ options: {}, settings: { net: false } });
    expect(settingsProblems('skins', { validate: true })).toEqual([]);
    expect(settingsProblems('skins', { carry: true })[0]).toMatch(/isn’t an option/);
    expect(settingsProblems('nassau', { press: 5 })[0]).toMatch(/choices/);
    expect(settingsProblems('nassau', { front: 2000 })[0]).toMatch(/dollars/);
  });
});
