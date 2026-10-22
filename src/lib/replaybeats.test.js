import { describe, it, expect } from 'vitest';
import { buildReplay } from './replay.js';
import {
  buildBeats, buildStory, chunk, holesLabel, holdMs, stepMs, storySeconds, skipTarget, commentaryByHole, cleanLine,
  describeBeats, MIN_MS, MAX_STRETCH,
} from './replaybeats.js';
import { pickVoice, voiceScore, createSpeaker, voiceRate, voiceTimeoutMs } from './voice.js';

const PARS = [[5, 17], [4, 9], [3, 8], [4, 3], [3, 11], [5, 16], [4, 18], [4, 15], [4, 1], [4, 6], [3, 14], [4, 5], [4, 10], [5, 7], [3, 12], [5, 2], [4, 13], [4, 4]];
const course = { id: 'c1', name: 'Shoalhaven Heads', holes: PARS.map(([par, si], i) => ({ n: i + 1, par, si })) };
const t = (i) => new Date(Date.UTC(2026, 9, 25, 0, i * 12)).toISOString();
const P = (id, name) => ({ id, name, nickname: null, handicap: 0 });
/** diffs: { hole: strokes over par } — every other hole is a par. */
function card(round, subject, diffs, type = 'team') {
  return PARS.map(([par], i) => ({ round_id: round, subject_id: subject, subject_type: type, hole: i + 1, strokes: par + (diffs[i + 1] || 0), picked_up: false, updated_at: t(i) }));
}
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The Sunday Ambrose shape: four pairs. Josh & Hamish birdie early and take the CTP, Tom & Dave eagle the 7th and
// go past, it swings back, Pete & Rob have a triple on 13, Josh & Hamish win on −9 net by 2 shots (with the LD).
function sundayAmbrose() {
  const R = UUID(900);
  const pl = ['Josh', 'Hamish', 'Tom', 'Dave', 'Pete', 'Rob', 'Macca', 'Sully'].map((n, i) => P(UUID(i + 1), n));
  const by = Object.fromEntries(pl.map((p) => [p.name, p]));
  const teams = [
    { id: UUID(101), name: 'Josh & Hamish', handicap: 0, players: [by.Josh, by.Hamish] },
    { id: UUID(102), name: 'Tom & Dave', handicap: 0, players: [by.Tom, by.Dave] },
    { id: UUID(103), name: 'Pete & Rob', handicap: 0, players: [by.Pete, by.Rob] },
    { id: UUID(104), name: 'Macca & Sully', handicap: 0, players: [by.Macca, by.Sully] },
  ];
  const round = { id: R, name: 'Sunday Ambrose', format: 'ambrose', status: 'locked', course_id: 'c1', ctp_holes: [5], ld_holes: [16], comp_bonus: 1, play_date: '2026-10-25' };
  const scores = [
    ...card(R, UUID(101), { 2: -1, 6: -1, 9: -1, 11: -1, 12: -1, 13: 1, 14: -1, 15: -1, 17: -1 }),
    ...card(R, UUID(102), { 1: -1, 4: -1, 7: -2, 8: -1, 10: -1, 14: 1, 16: -1, 18: -1 }),
    ...card(R, UUID(103), { 3: -1, 5: -1, 11: -1, 13: 3, 15: -1 }),
    ...card(R, UUID(104), { 9: -1, 10: -1 }),
  ];
  const sideEntries = [
    { round_id: R, kind: 'ctp', hole: 5, player_id: by.Hamish.id, distance_m: 1.4, confirmed: true },
    { round_id: R, kind: 'ld', hole: 16, player_id: by.Josh.id, distance_m: 271, confirmed: true },
  ];
  return { round, course, teams, roundPlayers: [], playersById: Object.fromEntries(pl.map((p) => [p.id, p])), scores, sideEntries };
}

/** A Stableford round where nothing happens: everyone pars every hole. */
function allPars() {
  const pl = [P('a', 'Al'), P('b', 'Bo'), P('c', 'Cy')];
  const round = { id: 'r9', name: 'Quiet', format: 'stableford', status: 'locked', course_id: 'c1' };
  return {
    round, course, playersById: Object.fromEntries(pl.map((p) => [p.id, p])),
    roundPlayers: pl.map((p) => ({ round_id: 'r9', player_id: p.id, playing_handicap: 0 })),
    scores: pl.flatMap((p) => card('r9', p.id, {}, 'player')),
  };
}

const covers = (beats, n) => {
  let at = 0;
  for (const b of beats) { if (b.from !== at || b.to < b.from) return false; at = b.to + 1; }
  return at === n;
};

describe('beats — Sunday Ambrose shape', () => {
  const replay = buildReplay(sundayAmbrose());
  const story = buildStory(replay, { style: 'broadcast', seed: 7, roundName: 'Sunday Ambrose', courseName: 'Shoalhaven Heads' });
  const { beats, steps } = story;

  it('the winner is right: Josh & Hamish, −9 net, by 2 shots', () => {
    expect(replay.winner).toMatchObject({ name: 'Josh & Hamish', display: '−9', by: '2 shots' });
  });

  it('far fewer beats than holes, and every hole is covered once, in order', () => {
    expect(beats.length).toBeLessThan(15);
    expect(beats.length).toBeGreaterThanOrEqual(7);
    expect(covers(beats, 18)).toBe(true);
  });

  it('quiet stretches are grouped (never more than 4 holes); key moments get their own beat', () => {
    for (const b of beats.filter((x) => x.type === 'stretch')) expect(b.to - b.from + 1).toBeLessThanOrEqual(MAX_STRETCH);
    expect(beats.some((b) => b.type === 'stretch' && b.to > b.from)).toBe(true);
    // Every lead change (and the eagle) is the headline of a beat that isn't a quiet stretch.
    replay.frames.forEach((f, i) => {
      if (!f.moments.some((m) => m.kind === 'lead_change' || m.kind === 'eagle')) return;
      const b = beats.find((x) => x.from <= i && i <= x.to);
      expect(b.type, `frame ${i}`).not.toBe('stretch');
    });
    const eagle = beats.find((b) => b.top?.kind === 'eagle');
    expect(eagle).toMatchObject({ top: { name: 'Tom & Dave', hole: 7 } });
  });

  it('the turn ends a beat, and the last three holes get one each', () => {
    expect(beats.find((b) => b.turn)).toMatchObject({ to: 8 });
    expect(beats.slice(-3).map((b) => [b.type, b.label])).toEqual([['finish', 'Hole 16'], ['finish', 'Hole 17'], ['finish', 'Hole 18']]);
    expect(beats.slice(-3).map((b) => b.left)).toEqual([2, 1, 0]);
  });

  it('the side comps show up: the CTP on 5 and the LD on 16', () => {
    const all = beats.flatMap((b) => b.moments.filter((m) => m.kind === 'side_comp').map((m) => ({ ...m, beat: b.label })));
    expect(all.map((m) => [m.name, m.hole])).toEqual([['Hamish', 5], ['Josh', 16]]);
    // …and are always said, even when a birdie on the same hole is the headline.
    expect(beats.find((b) => b.label === 'Hole 5').text).toMatch(/Hamish.*closest to the pin|closest to the pin.*Hamish/i);
    expect(beats.find((b) => b.label === 'Hole 16').text).toMatch(/longest drive/i);
  });

  it('team names get "they" verbs ("Josh & Hamish go past", not "goes")', () => {
    const text = steps.map((s) => s.text).join(' ');
    expect(text).not.toMatch(/(Josh & Hamish|Tom & Dave|Pete & Rob) (goes|picks|closes|gets|pinches|birdies|wins)\b/);
    for (const s of steps) if (s.text) expect(s.text.charAt(0)).toBe(s.text.charAt(0).toUpperCase());
  });

  it('steps: welcome → field → beats → 3 to play → last three → winner → awards → end', () => {
    const scenes = steps.map((s) => s.scene).filter((s, i, a) => s !== a[i - 1]);
    expect(scenes).toEqual(['welcome', 'field', 'race', 'finish', 'race', 'winner', 'awards', 'end']);
    expect(steps.filter((s) => s.scene === 'race')).toHaveLength(beats.length);
    expect(steps[steps.length - 1]).toMatchObject({ scene: 'end', ms: null });
  });

  it('every beat has a line; stretches say which holes and where the top stands', () => {
    for (const b of beats) expect(b.text.length).toBeGreaterThan(10);
    const first = beats[0];
    expect(first.text.startsWith(`${first.label}:`) || first.type !== 'stretch').toBe(true);
    // Somewhere the commentary says who's in front, by how much.
    expect(beats.some((b) => /Josh & Hamish.*(in front|on top|clear)/.test(b.text))).toBe(true);
    // The finish holes count down.
    expect(beats[beats.length - 3].text).toMatch(/2 to play|2 holes left/);
    expect(beats[beats.length - 2].text).toMatch(/One to play|Down the last/);
    const win = steps.find((s) => s.scene === 'winner');
    expect(win.text).toMatch(/Josh & Hamish/);
  });

  it('the same round, style and seed always tell the same story', () => {
    const again = buildStory(replay, { style: 'broadcast', seed: 7, roundName: 'Sunday Ambrose', courseName: 'Shoalhaven Heads' });
    expect(describeBeats(again)).toEqual(describeBeats(story));
  });

  it('Skip to the end goes to the winner', () => {
    expect(steps[skipTarget(steps)].scene).toBe('winner');
  });
});

describe('beats — a quiet round', () => {
  const replay = buildReplay(allPars());
  const beats = buildBeats(replay);
  it('nothing happens: holes are grouped in stretches of up to 4, split at the turn', () => {
    expect(beats.map((b) => b.label)).toEqual(['Holes 1–3', 'Holes 4–6', 'Holes 7–9', 'Holes 10–12', 'Holes 13–15', 'Hole 16', 'Hole 17', 'Hole 18']);
    expect(beats.find((b) => b.turn).label).toBe('Holes 7–9');
    expect(covers(beats, 18)).toBe(true);
  });
  it('quiet lines say so, and say it is tied', () => {
    const { steps } = buildStory(replay, { seed: 3 });
    const race = steps.filter((s) => s.scene === 'race');
    expect(race[0].text).toMatch(/^Holes 1–3: /);
    expect(race[0].text).toMatch(/square|Level/);
  });
});

describe('beats — Stableford with a lead change and a blow-up', () => {
  // Al leads early (birdie 1), blows up on 10; Bo birdies 10 and 11.
  const pl = [P('a', 'Al'), P('b', 'Bo'), P('c', 'Cy'), P('d', 'Di')];
  const round = { id: 'r1', name: 'Saturday', format: 'stableford', status: 'locked', course_id: 'c1' };
  const replay = buildReplay({
    round, course, playersById: Object.fromEntries(pl.map((p) => [p.id, p])),
    roundPlayers: pl.map((p) => ({ round_id: 'r1', player_id: p.id, playing_handicap: 0 })),
    scores: [...card('r1', 'a', { 1: -1, 10: 3 }, 'player'), ...card('r1', 'b', { 10: -1, 11: -1 }, 'player'), ...card('r1', 'c', {}, 'player'), ...card('r1', 'd', Object.fromEntries(PARS.map((_, i) => [i + 1, 1])), 'player')],
  });
  const beats = buildBeats(replay);
  it('hole 10 is its own beat about the new leader, and the board is shown after it', () => {
    const b = beats.find((x) => x.from <= 9 && 9 <= x.to);
    expect(b.type).toBe('moment');
    expect(b.top).toMatchObject({ kind: 'lead_change', name: 'Bo' });
    expect(b.standing).toMatchObject({ kind: 'new', name: 'Bo' });
  });
  it('the birdie on 1 makes the opening a key beat', () => {
    expect(beats[0]).toMatchObject({ from: 0, type: 'moment' });
    expect(beats[0].top.kind).toBe('birdie');
  });
});

describe('helpers', () => {
  it('chunk splits evenly', () => {
    expect(chunk([1, 2, 3, 4, 5]).map((c) => c.length)).toEqual([3, 2]);
    expect(chunk([1, 2, 3, 4]).map((c) => c.length)).toEqual([4]);
    expect(chunk([1, 2, 3, 4, 5, 6, 7, 8, 9]).map((c) => c.length)).toEqual([3, 3, 3]);
    expect(chunk([])).toEqual([]);
  });
  it('labels', () => {
    const fr = [10, 11, 12, 18, 1, 2].map((h) => ({ hole: h, label: `Hole ${h}` }));
    expect(holesLabel(fr, 0, 2)).toBe('Holes 10–12');
    expect(holesLabel(fr, 3, 5)).toBe('Holes 18, 1, 2');
    expect(holesLabel(fr, 1, 1)).toBe('Hole 11');
    expect(holesLabel([{ hole: null, label: '1 hole in' }, { hole: null, label: '2 holes in' }], 0, 1)).toBe('1–2 holes in');
  });
});

describe('timing and speeds', () => {
  const replay = buildReplay(sundayAmbrose());
  const { steps } = buildStory(replay, { seed: 1, roundName: 'Sunday Ambrose', courseName: 'Shoalhaven Heads' });

  it('each beat holds long enough to read; longer lines hold longer; key moments and the finish hold longer', () => {
    expect(holdMs('stretch', 'Short.')).toBe(MIN_MS.stretch);
    expect(holdMs('stretch', 'x'.repeat(120))).toBeGreaterThan(holdMs('stretch', 'x'.repeat(60)));
    expect(holdMs('moment', 'Short.')).toBeGreaterThan(holdMs('stretch', 'Short.'));
    expect(holdMs('finish', 'Short.')).toBeGreaterThan(holdMs('moment', 'Short.'));
    expect(holdMs('winner', 'Short.')).toBeGreaterThanOrEqual(7500);
    for (const s of steps.filter((x) => x.ms != null)) expect(s.ms).toBeGreaterThanOrEqual(3500);
    expect(holdMs('stretch', 'x'.repeat(1000))).toBe(12000);
  });

  it('Normal is the default; Fast is about twice as quick; quick (tests) is 150 ms a step', () => {
    const normal = storySeconds(steps);
    const fast = storySeconds(steps, 'fast');
    expect(normal).toBeGreaterThan(60);
    expect(normal).toBeLessThan(180);
    expect(fast).toBeLessThan(normal * 0.62);
    expect(fast).toBeGreaterThan(normal * 0.4);
    expect(stepMs(steps[2])).toBe(steps[2].ms);
    expect(stepMs(steps[2], 'quick')).toBe(150);
    expect(stepMs({ ms: null }, 'fast')).toBeNull();
    expect(stepMs({ ms: 3000 }, 'fast')).toBe(2000); // never under 2 s, even on Fast
  });
});

describe('live commentary lines', () => {
  const R = UUID(900);
  const rows = [
    { key: `birdies:${R}:${UUID(101)}:12`, kind: 'birdies', facts: { hole: 12 }, line: '🎙️ Back-to-back birdies for Josh & Hamish on 12. Lovely stuff.', status: 'ready' },
    { key: `lead:${R}:${UUID(101)}:12`, kind: 'lead', facts: { hole: 12 }, line: 'Josh & Hamish go top after 12.', status: 'ready' },
    { key: `report:${R}`, kind: 'report', facts: {}, line: 'Josh & Hamish took the Sunday Ambrose on −9.', status: 'ready' },
    { key: `ace:${R}:${UUID(102)}:3`, kind: 'ace', facts: { hole: 3 }, line: 'hidden', status: 'hidden' },
  ];
  it('picks the best line per hole, keeps the report apart, skips hidden ones', () => {
    const { byHole, report } = commentaryByHole(rows);
    expect(byHole[12]).toEqual({ kind: 'lead', line: 'Josh & Hamish go top after 12.' });
    expect(byHole[3]).toBeUndefined();
    expect(report).toBe('Josh & Hamish took the Sunday Ambrose on −9.');
  });
  it('the beat with hole 12 uses it, and the end card reads the report', () => {
    const replay = buildReplay(sundayAmbrose());
    const story = buildStory(replay, { seed: 1, commentary: rows });
    const b = story.beats.find((x) => x.from <= 11 && 11 <= x.to);
    expect(b.text).toMatch(/go top after 12/);
    expect(story.steps[story.steps.length - 1].text).toBe('Josh & Hamish took the Sunday Ambrose on −9.');
  });
  it('cleanLine drops the mic and trims long lines at a full stop', () => {
    expect(cleanLine('🎙️ Hello.')).toBe('Hello.');
    const long = `${'A sentence that goes on. '.repeat(12)}`;
    const c = cleanLine(long);
    expect(c.length).toBeLessThanOrEqual(180);
    expect(c.endsWith('.')).toBe(true);
  });
});

describe('voice', () => {
  const V = (name, lang, extra = {}) => ({ name, lang, localService: true, ...extra });
  it('prefers an Australian natural voice, then British, never a joke voice or another language', () => {
    const voices = [V('Fred', 'en-US'), V('Thomas', 'fr-FR'), V('Daniel', 'en-GB'), V('Karen', 'en-AU'), V('Lee (Enhanced)', 'en-AU')];
    expect(pickVoice(voices).name).toBe('Lee (Enhanced)');
    expect(pickVoice([V('Daniel', 'en-GB'), V('Samantha', 'en-US')]).name).toBe('Daniel');
    expect(pickVoice([V('Thomas', 'fr-FR')])).toBeNull();
    expect(voiceScore(V('Zarvox', 'en-US'))).toBeLessThan(voiceScore(V('Samantha', 'en-US')));
    expect(pickVoice([])).toBeNull();
  });
  it('a touch slower than normal; a little quicker on Fast', () => {
    expect(voiceRate('normal')).toBeLessThan(1);
    expect(voiceRate('fast')).toBeGreaterThan(1);
    expect(voiceTimeoutMs('x'.repeat(100), 1)).toBeGreaterThan(10000);
  });

  function fakeSynth() {
    const log = [];
    const synth = {
      speaking: null,
      getVoices: () => [V('Karen', 'en-AU')],
      cancel() { log.push('cancel'); const u = this.speaking; this.speaking = null; u?.onerror?.({ error: 'interrupted' }); },
      speak(u) { log.push(`speak:${u.text}`); this.speaking = u; },
      finish() { const u = this.speaking; this.speaking = null; u?.onend?.(); },
    };
    function Utterance(text) { this.text = text; }
    return { synth, Utterance, log };
  }
  const noTimers = { setTimer: () => 1, clearTimer: () => {} };

  it('waits for the line to finish: onEnd runs when it ends, not before', () => {
    const { synth, Utterance } = fakeSynth();
    const sp = createSpeaker(synth, Utterance, noTimers);
    let ended = 0;
    sp.speak('Hole 10: Bo goes top.', { rate: 0.92, onEnd: () => ended++ });
    expect(ended).toBe(0);
    expect(synth.speaking.voice.name).toBe('Karen');
    expect(synth.speaking.rate).toBe(0.92);
    synth.finish();
    expect(ended).toBe(1);
  });

  it('never talks over itself: a new line cancels the old one first, and the old one never counts as finished', () => {
    const { synth, Utterance, log } = fakeSynth();
    const sp = createSpeaker(synth, Utterance, noTimers);
    const ends = [];
    sp.speak('one', { onEnd: () => ends.push('one') });
    sp.speak('two', { onEnd: () => ends.push('two') });
    expect(log).toEqual(['cancel', 'speak:one', 'cancel', 'speak:two']);
    synth.finish();
    expect(ends).toEqual(['two']);
  });

  it('stop (pause / skip) cuts it cleanly and nothing moves on', () => {
    const { synth, Utterance, log } = fakeSynth();
    const sp = createSpeaker(synth, Utterance, noTimers);
    let ended = 0;
    sp.speak('one', { onEnd: () => ended++ });
    sp.stop();
    expect(log[log.length - 1]).toBe('cancel');
    synth.finish();
    expect(ended).toBe(0);
  });

  it('a phone that never says "finished" still moves on after a generous wait', () => {
    const { synth, Utterance } = fakeSynth();
    let fire = null;
    const sp = createSpeaker(synth, Utterance, { setTimer: (f) => { fire = f; return 1; }, clearTimer: () => {} });
    let ended = 0;
    sp.speak('one', { onEnd: () => ended++ });
    fire();
    expect(ended).toBe(1);
    synth.finish(); // a late "finished" doesn't count twice
    expect(ended).toBe(1);
  });

  it('no voice on this phone: carries on straight away', () => {
    const sp = createSpeaker(null, null, noTimers);
    let ended = 0;
    sp.speak('one', { onEnd: () => ended++ });
    expect(ended).toBe(1);
    expect(sp.ok).toBe(false);
  });
});
