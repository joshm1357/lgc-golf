// The Weekend Recap (ov37, migration 105) — the words side, shared by the ai-helper function (Deno) and the app
// (src/lib/recap.js, screens/Recap.jsx and their tests). Plain JavaScript, no imports.
//
// Josh, 24 Oct: "some sort of commentary recap of the weekend… that includes all the historical stuff… Try make it
// funny… like the commentators in Dodgeball." So: a two-person sports-broadcast duo, over the top and deadpan — our
// OWN characters with our own names and our own jokes. No film's character names, catchphrases or lines.
//
// What's here:
//   * VOICES — the two commentators (A: play-by-play, B: the colour commentator).
//   * factLines(facts) — the trip's facts as short plain sentences: the model reads these (as data), the recap screen
//     shows them under "What the commentators had to go on", and the number check below uses them.
//   * checkScript(raw, opts) — is a script we can use? 8–14 lines, both voices taking turns, short, only people from
//     this trip, no film names, nothing about looks / weight / money / families, and no number that isn't in the facts.
//   * templateScript(facts) — a script written from the facts alone, for when the AI isn't on, is over its limit or
//     fails. Same tone, no AI.
//   * scriptText(recap, link) — the transcript for the group chat.

export const VOICES = {
  A: { key: 'A', name: 'Rex Fairway', role: 'Play-by-play', short: 'Rex', blurb: 'Booming, breathless, treats a two-putt like a moon landing.' },
  B: { key: 'B', name: 'Bev Divot', role: 'Colour commentator', short: 'Bev', blurb: 'Bone-dry. Has seen it all, mostly from the cart path.' },
};

export const LIMITS = { minLines: 8, maxLines: 14, lineChars: 240, totalChars: 1700, titleMin: 3, titleChars: 80, factsChars: 16000, factLines: 60 };

// Words that would drag a film into it (names, places and lines from sports-comedy films). Never in a script.
export const FILM_WORDS = [
  'dodgeball', 'pepper brooks', 'cotton mcknight', 'white goodman', 'globo gym', 'average joe', 'patches o', 'la fleur', 'lafleur',
  'dodge, duck', 'happy gilmore', 'shooter mcgavin', 'caddyshack', 'carl spackler', 'judge smails', 'tin cup', 'bagger vance',
];
// Off limits (Josh: friendly, never mean — nothing about looks, weight, money or families).
export const OFF_LIMITS = /\b(fat|obese|weight|belly|beer gut|bald|ugly|looks like|wife|missus|husband|girlfriend|boyfriend|kids?|children|divorce|mum|mother|dad|father|money|cash|broke|salary|wages|debt|mortgage|dollars?|bucks)\b|\$\s?\d/i;

const toText = (v, max) => String(v ?? '').replace(/[<>]/g, ' ').replace(/[\u0000-\u001f\u007f  ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (a) => { const x = (a || []).filter(Boolean); return x.length <= 1 ? (x[0] || '') : `${x.slice(0, -1).join(', ')} and ${x[x.length - 1]}`; };
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

/** The facts as short sentences, grouped: [{ section, text }]. Only what's in the facts; nothing made up. */
export function factLines(facts = {}) {
  const f = facts || {};
  const out = [];
  const add = (section, text) => { const t = toText(text, 220); if (t) out.push({ section, text: t }); };
  const t = f.trip || {};
  if (t.name) add('trip', `${t.name}${t.dates ? `, ${t.dates}` : ''}: ${plural(t.rounds || 0, 'round')}, ${plural((f.players || []).length, 'player')}.`);
  if (f.winner?.line) add('winner', `${f.winner.line}${f.winner.score ? ` (${f.winner.score})` : ''}.`);
  for (const x of f.trophies || []) if (x.line && x.line !== f.winner?.line) add('trophies', `${x.line}.`);
  for (const h of f.history || []) add('history', h);
  if (f.cup) add('cup', f.cup);
  for (const r of f.rounds || []) {
    if (r.winners) add('rounds', `${r.name}${r.format ? ` (${r.format})` : ''}: won by ${r.winners}${r.score ? ` with ${r.score}` : ''}${r.podium?.length > 1 ? `; then ${r.podium.slice(1).join(', ')}` : ''}.`);
    if (r.last) add('rounds', `${r.name}: last was ${r.last}.`);
  }
  for (const b of f.big || []) add('holes', `Biggest number: ${b.name} made ${b.strokes} on the par-${b.par} ${ord(b.hole)} (${b.round}).`);
  for (const b of f.birdies || []) add('holes', `${b.name} had ${plural(b.count, 'birdie')} or better across the trip.`);
  for (const c of f.comps || []) add('comps', `${c.label}: ${c.name}.`);
  for (const m of f.moments || []) add('moments', `${m.name} posted a ${String(m.kind).toLowerCase()} on the ${ord(m.hole)}${m.round ? ` (${m.round})` : ''}.`);
  if (f.photos) add('moments', `${plural(f.photos, 'photo')} went up in the Feed.`);
  for (const c of f.tribunal || []) {
    add('tribunal', `Tribunal: ${c.title}${c.accused ? ` — ${c.accused} in the dock` : ''}${c.charge ? `. The charge: “${c.charge}”` : ''}${c.defence ? `. The defence: “${c.defence}”` : ''}${c.verdict ? `. Verdict: ${c.verdict}` : '. No verdict yet'}.`);
  }
  for (const x of f.fines || []) add('fines', `${x.name}: ${plural(x.count, 'fine')}${x.titles?.length ? ` (${x.titles.join(', ')})` : ''}.`);
  for (const a of f.awards || []) add('awards', `${a.fine ? 'Fine' : 'Award'} “${a.title}”: ${a.name}.`);
  for (const m of f.missing || []) add('missing', `${m.round}: only ${m.have} of ${m.of} cards are in the app.`);
  return out.slice(0, LIMITS.factLines);
}

/** Every number written in the facts (so a script can't invent a score). Hole numbers and the year count. */
export function factNumbers(facts = {}) {
  const s = new Set(['18', '9', '1', '2', '3']);
  const text = factLines(facts).map((l) => l.text).join(' ') + JSON.stringify(facts || {});
  for (const m of text.match(/\d+(?:\.\d+)?/g) || []) s.add(String(Number(m)));
  return s;
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, name) => {
  const n = String(name || '').trim();
  if (n.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(n)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
};

/**
 * Check a script. raw: { title, lines: [{ who: 'A'|'B', text }] } (from the model, or the database).
 * opts: { tripNames: names of people in this trip, otherNames: the group's other players (who weren't there),
 *         facts (for the number check) }.
 * → { ok, script: { title, lines }, problems: [plain words] }. The script is cleaned (short, one line each).
 */
export function checkScript(raw, { tripNames = [], otherNames = [], facts = null } = {}) {
  const problems = [];
  const title = toText(raw?.title, LIMITS.titleChars);
  const lines = (Array.isArray(raw?.lines) ? raw.lines : [])
    .map((l) => ({ who: l?.who === 'B' ? 'B' : l?.who === 'A' ? 'A' : null, text: toText(l?.text, LIMITS.lineChars + 1) }))
    .filter((l) => l.who && l.text);
  if (title.length < LIMITS.titleMin) problems.push('Give it a short title.');
  if (lines.length < LIMITS.minLines || lines.length > LIMITS.maxLines) problems.push(`Use ${LIMITS.minLines} to ${LIMITS.maxLines} lines (you used ${lines.length}).`);
  if (lines.some((l) => l.text.length > LIMITS.lineChars)) problems.push(`Keep every line under ${LIMITS.lineChars} characters.`);
  const total = lines.reduce((n, l) => n + l.text.length, 0);
  if (total > LIMITS.totalChars) problems.push(`Too long to read in 90 seconds (${total} characters; keep it under ${LIMITS.totalChars}).`);
  if (lines.length && (!lines.some((l) => l.who === 'A') || !lines.some((l) => l.who === 'B'))) problems.push('Both commentators need to speak.');
  for (let i = 2; i < lines.length; i++) if (lines[i].who === lines[i - 1].who && lines[i].who === lines[i - 2].who) { problems.push('Take turns — no voice gets three lines in a row.'); break; }
  const all = `${title} ${lines.map((l) => l.text).join(' ')}`;
  const low = all.toLowerCase();
  const film = FILM_WORDS.find((w) => low.includes(w));
  if (film) problems.push('Use our own commentators and jokes — no film names or quotes.');
  if (OFF_LIMITS.test(all)) problems.push('Keep it friendly: nothing about looks, weight, money or families.');
  const here = new Set(tripNames.map((n) => String(n).trim()).filter(Boolean));
  const away = [...new Set(otherNames.map((n) => String(n).trim()).filter((n) => n && !here.has(n)))];
  // Someone who wasn't there can still come up if the facts mention them (last year's winner, from the honour board).
  const inFacts = facts ? factLines(facts).map((l) => l.text).join(' ') : '';
  const wrong = away.filter((n) => mentions(all, n) && !mentions(inFacts, n) && ![...here].some((h) => h.includes(n) && mentions(all, h)));
  if (wrong.length) problems.push(`Only people on this trip — ${list(wrong.slice(0, 3))} weren’t there.`);
  if (facts) {
    const ok = factNumbers(facts);
    const made = [...new Set((all.replace(/\b(19|20)\d\d\b/g, (y) => (ok.has(y) ? '' : y)).match(/\d+(?:\.\d+)?/g) || []).map((m) => String(Number(m))))].filter((n) => !ok.has(n));
    if (made.length) problems.push(`Only numbers from the facts (${list(made.slice(0, 3))} isn’t in them).`);
  }
  return { ok: problems.length === 0, script: { title: title || 'The Weekend Recap', lines: lines.slice(0, LIMITS.maxLines) }, problems };
}

// ------------------------------------------------------------------ The script from the facts alone (no AI)

/**
 * A recap written from the facts, no AI: the same two voices, only facts, 8–14 lines. Deterministic (the same facts
 * give the same script), so a test can check it and the server and the app agree.
 */
export function templateScript(facts = {}) {
  const f = facts || {};
  const trip = f.trip?.name || 'the trip';
  const lines = [];
  const A = (text) => lines.push({ who: 'A', text });
  const B = (text) => lines.push({ who: 'B', text });
  A(`Good evening and welcome to The Weekend Recap — ${trip}. I’m Rex Fairway, and I have not slept.`);
  B(`I’m Bev Divot. ${f.trip?.rounds ? `${plural(f.trip.rounds, 'round')} of golf, ` : ''}and Rex has called every one of them a classic.`);
  if (f.winner?.line) {
    A(`The headline, Bev: ${f.winner.line}${f.winner.score ? `, on ${f.winner.score}` : ''}! Unbelievable scenes!`);
    B('Very believable, Rex. It’s on the scorecard.');
  } else {
    A('No trophy decided yet, Bev, and the tension is unbearable.');
    B('It’s mostly paperwork, Rex.');
  }
  for (const h of (f.history || []).filter((x) => !OFF_LIMITS.test(x)).slice(0, 1)) B(`For the history books: ${h.replace(/\.$/, '')}.`);
  for (const r of (f.rounds || []).filter((x) => x.winners).slice(0, 2)) A(`${r.name} went to ${r.winners}${r.score ? ` with ${r.score}` : ''}. Pure theatre!`);
  const big = (f.big || [])[0];
  if (big) B(`Meanwhile ${big.name} made a ${big.strokes} on the par-${big.par} ${ord(big.hole)}. We’ll call that character building.`);
  const m = (f.moments || [])[0];
  if (m) A(`And the Feed tells me ${m.name} posted a ${String(m.kind).toLowerCase()} on the ${ord(m.hole)}! I need a moment!`);
  const c = (f.tribunal || []).find((x) => !OFF_LIMITS.test(`${x.title} ${x.defence || ''} ${x.verdict || ''}`));
  if (c) {
    B(`The Tribunal sat${c.accused ? `, with ${c.accused} in the dock` : ''}: “${toText(c.title, 60)}”.${c.verdict ? ` Verdict: ${toText(c.verdict, 40)}.` : ' Still deliberating.'}`);
    if (c.defence) A(`The defence? “${toText(c.defence, 80)}” Bold. Legally fascinating.`);
  }
  const fine = (f.fines || [])[0];
  if (fine) B(`Fines tally leader: ${fine.name}, with ${plural(fine.count, 'fine')}. A proud record.`);
  const comp = (f.comps || [])[0];
  if (comp && lines.length < LIMITS.maxLines - 3) A(`${comp.label}: ${comp.name}. Take a bow!`);
  const gap = (f.missing || []).filter((x) => x.of > x.have);
  if (gap.length) {
    const g = gap[0];
    A(`But Bev — ${g.round}, only ${g.have} of ${g.of} cards are in. Where are the rest?`);
    B(`Hiding, Rex. Add your card and you’re in the next recap. Until then, legally, you were never there.`);
  }
  A(`That’s The Weekend Recap. For Bev Divot, I’m Rex Fairway.`);
  B('Same time next trip.');
  // Fill up to the minimum without making anything up.
  const pad = [
    { who: 'B', text: 'Every shot on this trip has happened, Rex. I checked.' },
    { who: 'A', text: 'Golf, Bev! Glorious, ridiculous golf!' },
    { who: 'B', text: 'Plenty more where that came from. Mostly in the trees.' },
  ];
  while (lines.length < LIMITS.minLines && pad.length) lines.splice(Math.max(2, lines.length - 2), 0, pad.shift());
  // No three-in-a-row: swap in a short reply from the other voice where it happens.
  const fixed = [];
  for (const l of lines) {
    const n = fixed.length;
    if (n >= 2 && fixed[n - 1].who === l.who && fixed[n - 2].who === l.who) fixed.push({ who: l.who === 'A' ? 'B' : 'A', text: l.who === 'A' ? 'Go on, Rex.' : 'Over to you, Bev.' });
    fixed.push(l);
  }
  // Keep it to the limit: the first lines (the story) and the sign-off.
  const out = fixed.length > LIMITS.maxLines ? [...fixed.slice(0, LIMITS.maxLines - 2), ...fixed.slice(-2)] : fixed;
  return { title: `The Weekend Recap: ${toText(trip, 50)}`, lines: out.map((l) => ({ who: l.who, text: toText(l.text, LIMITS.lineChars) })) };
}

/** The transcript for the group chat: the title, each line with its speaker, and the link to have a listen. */
export function scriptText(recap, link = '') {
  if (!recap) return '';
  const lines = (recap.lines || []).map((l) => `${VOICES[l.who]?.short || l.who}: ${l.text}`);
  return [`📺 ${recap.title}`, '', ...lines, ...(link ? ['', `▶️ Have a listen: ${link}`] : [])].join('\n');
}

/** The Feed post when the organiser publishes it. */
export const feedLine = (title) => `📺 The Weekend Recap is out: ${toText(title, 80)} — ▶️ have a listen`;
