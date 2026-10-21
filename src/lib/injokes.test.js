import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MOMENTS, BLOCKED, BLOCKED_PHRASES, EXAMPLES, normalise, isBlocked, checkJoke, canEdit, fillJoke, pickJoke, jokePicker, groupJokes,
  jokesFromLines, lineFor,
} from './injokes.js';

const AL = 'p-al';
const BO = 'p-bo';
const j = (id, text, moment = 'any', player_id = null, extra = {}) => ({ id, text, moment, player_id, active: true, ...extra });

describe('fillJoke', () => {
  it('swaps {name}, any case and spacing, every time', () => {
    expect(fillJoke("{name}'s driver has a mind of its own", { name: 'Kurt' })).toBe("Kurt's driver has a mind of its own");
    expect(fillJoke('{ Name } and {NAME}', { name: 'Al' })).toBe('Al and Al');
  });
  it('no name: someone (capitalised at the start)', () => {
    expect(fillJoke('{name} found the water again')).toBe('Someone found the water again');
    expect(fillJoke('Lunch is on {name}', { name: '  ' })).toBe('Lunch is on someone');
  });
  it('text without a placeholder is unchanged', () => {
    expect(fillJoke('Grip it and rip it', { name: 'Al' })).toBe('Grip it and rip it');
  });
});

describe('the block list', () => {
  it('blocks slurs as whole words, with l33t and punctuation undone', () => {
    expect(isBlocked('what a retard')).toBe(true);
    expect(isBlocked('R3T4RD shot')).toBe(true);
    expect(isBlocked('f.a.g')).toBe(false); // split into letters — not a word
    expect(isBlocked('you f@g')).toBe(true);
    expect(isBlocked('just kill yourself')).toBe(true);
    expect(isBlocked('KYS mate')).toBe(true);
  });
  it('leaves golf and ordinary swearing alone, and words that only contain a blocked word', () => {
    for (const ok of ["{name}'s driver has a mind of its own", 'shank city, bloody hell', 'about time', 'Mongolia tour',
      'spicy pies at the turn', 'cocoon of shame', 'par 4 and a bogey', 'scunthorpe', 'dykehouse']) {
      expect(isBlocked(ok)).toBe(false);
    }
  });
  it('normalise lower-cases, undoes l33t and squashes punctuation', () => {
    expect(normalise("H3LL0, {name}'s!")).toBe('hello name si');
  });
  it('checkJoke: length and block list', () => {
    expect(checkJoke('')).toMatch(/Write/);
    expect(checkJoke(' a ')).toMatch(/Write/);
    expect(checkJoke('ok')).toBe('');
    expect(checkJoke('x'.repeat(141))).toMatch(/140/);
    expect(checkJoke('x'.repeat(140))).toBe('');
    expect(checkJoke('what a spastic')).toMatch(/friendly/);
  });
  it('every example is fine and short enough', () => {
    for (const e of EXAMPLES) {
      expect(checkJoke(e.text)).toBe('');
      expect(MOMENTS.map((m) => m.value)).toContain(e.moment);
    }
  });
  it('the database (058) has the same block list, phrases and moments', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/058_in_jokes.sql'), 'utf8');
    const words = sql.split('-- BLOCKED-START')[1].split('-- BLOCKED-END')[0].match(/'([a-z ]+)'/g).map((s) => s.slice(1, -1));
    expect(new Set(words.filter((w) => !w.includes(' ')))).toEqual(new Set(BLOCKED));
    expect(new Set(words.filter((w) => w.includes(' ')))).toEqual(new Set(BLOCKED_PHRASES));
    const moments = sql.match(/moment in \(([^)]+)\)/)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
    expect(moments).toEqual(MOMENTS.map((m) => m.value));
  });
});

describe('canEdit', () => {
  it('the person who added it, or an organiser', () => {
    const joke = j('1', 'x', 'any', null, { created_by: AL });
    expect(canEdit(joke, { playerId: AL })).toBe(true);
    expect(canEdit(joke, { playerId: BO })).toBe(false);
    expect(canEdit(joke, { playerId: BO, isOrganiser: true })).toBe(true);
    expect(canEdit(joke, {})).toBe(false);
    expect(canEdit(null, { isOrganiser: true })).toBe(false);
  });
});

describe('pickJoke', () => {
  const jokes = [
    j('a1', 'Al birdie', 'birdie', AL),
    j('a2', 'Al birdie 2', 'birdie', AL),
    j('g1', 'Anyone birdie', 'birdie'),
    j('aa', 'Al any', 'any', AL),
    j('ga', 'Anyone any', 'any'),
    j('b1', 'Bo birdie', 'birdie', BO),
    j('r1', 'Retired Al birdie', 'birdie', AL, { active: false }),
  ];
  const pick = (opts) => pickJoke(jokes, opts)?.id;

  it('prefers this player and moment', () => {
    expect(['a1', 'a2']).toContain(pick({ playerId: AL, moment: 'birdie', seed: 1 }));
  });
  it('then that moment for anyone, then this player any time, then anyone any time', () => {
    expect(pick({ playerId: 'p-cy', moment: 'birdie' })).toBe('g1');
    expect(pick({ playerId: AL, moment: 'bogey' })).toBe('aa');
    expect(pick({ playerId: 'p-cy', moment: 'bogey' })).toBe('ga');
    expect(pick({ moment: 'birdie' })).toBe('g1');
    expect(pick({})).toBe('ga');
  });
  it('never picks a joke about someone else, or a retired one', () => {
    for (let s = 0; s < 50; s += 1) {
      const id = pick({ playerId: AL, moment: 'birdie', seed: s });
      expect(['b1', 'r1']).not.toContain(id);
    }
    expect(pickJoke([j('b1', 'Bo', 'birdie', BO)], { playerId: AL, moment: 'birdie' })).toBe(null);
  });
  it('same seed, same pick; different seeds reach both', () => {
    const a = pick({ playerId: AL, moment: 'birdie', seed: 'round-7' });
    expect(pick({ playerId: AL, moment: 'birdie', seed: 'round-7' })).toBe(a);
    const seen = new Set(Array.from({ length: 40 }, (_, s) => pick({ playerId: AL, moment: 'birdie', seed: s })));
    expect(seen).toEqual(new Set(['a1', 'a2']));
  });
  it('the order the jokes come in doesn’t change the pick', () => {
    const a = pick({ playerId: AL, moment: 'birdie', seed: 3 });
    expect(pickJoke([...jokes].reverse(), { playerId: AL, moment: 'birdie', seed: 3 }).id).toBe(a);
  });
  it('never the same joke twice in a row', () => {
    expect(pick({ playerId: AL, moment: 'birdie', last: 'a1', seed: 9 })).toBe('a2');
    expect(pick({ playerId: AL, moment: 'birdie', last: { id: 'a2' }, seed: 9 })).toBe('a1');
    // The only one that fits was just used: falls to the next kind…
    expect(pickJoke([j('x', 'X', 'birdie', AL), j('y', 'Y')], { playerId: AL, moment: 'birdie', last: 'x' }).id).toBe('y');
    // …or nothing at all, rather than a repeat.
    expect(pickJoke([j('x', 'X')], { last: 'x' })).toBe(null);
  });
  it('empty or missing lists give null', () => {
    expect(pickJoke([], { playerId: AL })).toBe(null);
    expect(pickJoke(undefined)).toBe(null);
  });
});

describe('jokePicker', () => {
  it('a run of picks never repeats back to back, and is steady for a seed', () => {
    const jokes = [j('a', 'A'), j('b', 'B'), j('c', 'C', 'birdie', AL)];
    const run = (seed) => { const next = jokePicker(jokes, { seed }); return Array.from({ length: 12 }, () => next({ playerId: AL, moment: 'bogey' })?.id); };
    const r = run('r1');
    for (let i = 1; i < r.length; i += 1) expect(r[i]).not.toBe(r[i - 1]);
    expect(run('r1')).toEqual(r);
    const next = jokePicker(jokes, { seed: 1 });
    expect(next({ playerId: AL, moment: 'birdie' }).id).toBe('c');
    expect(['a', 'b']).toContain(next({ playerId: AL, moment: 'birdie' }).id); // c was just used
  });
});

describe('groupJokes', () => {
  it('groups by player, Everyone first then names in order, newest joke first, retired left out', () => {
    const players = { [AL]: { name: 'Al Blue' }, [BO]: { name: 'Bo Red', nickname: 'Bozza' } };
    const out = groupJokes([
      j('1', 'old', 'any', BO, { created_at: '2026-01-01' }),
      j('2', 'new', 'any', BO, { created_at: '2026-02-01' }),
      j('3', 'gen', 'any', null),
      j('4', 'al', 'birdie', AL),
      j('5', 'gone', 'any', AL, { active: false }),
    ], players);
    expect(out.map((g) => g.name)).toEqual(['Everyone', 'Al Blue', 'Bozza']);
    expect(out[2].jokes.map((x) => x.id)).toEqual(['2', '1']);
    expect(out[1].jokes.map((x) => x.id)).toEqual(['4']);
    expect(groupJokes([j('5', 'gone', 'any', AL, { active: false })], players, { withRetired: true })[0].jokes).toHaveLength(1);
  });
});

describe('jokesFromLines (072: a few lines from in_joke_lines, never the list)', () => {
  it('turns lines into any-moment jokes for nobody in particular', () => {
    expect(jokesFromLines(['Dave still owes everyone for the cab', '  The ferry   to nowhere '])).toEqual([
      { id: 'line-0', text: 'Dave still owes everyone for the cab', moment: 'any', player_id: null, active: true },
      { id: 'line-1', text: 'The ferry to nowhere', moment: 'any', player_id: null, active: true },
    ]);
  });
  it('drops junk, blocked words, leftover {name}, repeats and anything too long', () => {
    expect(jokesFromLines(['ok fine', 'OK  fine!', null, 7, '', 'x', 'what a retard', '{name} again', 'y'.repeat(141)]).map((j) => j.text)).toEqual(['ok fine']);
    expect(jokesFromLines(null)).toEqual([]);
    expect(jokesFromLines({})).toEqual([]);
  });
  it('lineFor: steady for a seed, null when there is nothing', () => {
    const lines = ['One joke here', 'Two jokes here', 'Three jokes here'];
    expect(lineFor(lines, 'award-1')).toBe(lineFor(lines, 'award-1'));
    expect(lines).toContain(lineFor(lines, 'award-2'));
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => lineFor(lines, s))).size).toBeGreaterThan(1);
    expect(lineFor([], 'x')).toBeNull();
    expect(lineFor(['retard'], 'x')).toBeNull();
  });
  it('the AI job (jokes.ts) uses the same block list', () => {
    const ts = fs.readFileSync(path.resolve(__dirname, '../../supabase/functions/ai-helper/jokes.ts'), 'utf8');
    const words = ts.split('// BLOCKED-START')[1].split('// BLOCKED-END')[0].match(/'([a-z ]+)'/g).map((s) => s.slice(1, -1));
    expect(new Set(words)).toEqual(new Set(BLOCKED));
  });
});
