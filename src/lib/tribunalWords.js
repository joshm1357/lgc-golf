// ov38 (migration 106): the Handicap Tribunal's closing time and Feed posts, in the app's words. The database writes
// the posts themselves (private.tribunal_*_words); these are the small bits the app shows next to them.

const TZ = 'Australia/Sydney';

/** "Sun 8pm", "Sat 7:30am" — Sydney time, the same as the database's private.tribunal_clock. */
export function closingLabel(at) {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d);
  const v = (t) => parts.find((p) => p.type === t)?.value || '';
  const mins = v('minute');
  return `${v('weekday')} ${v('hour')}${mins === '00' ? '' : `:${mins}`}${v('dayPeriod').toLowerCase().replace(/\./g, '')}`;
}

/** The line under the votes on an open case. */
export function closingLine(c, now = Date.now()) {
  if (!c?.closes_at) return 'Closes once everyone has voted, or when the chair closes it.';
  const gone = new Date(c.closes_at).getTime() <= now;
  if (gone) return 'Voting has closed — the verdict is on its way.';
  return `Voting closes ${closingLabel(c.closes_at)} (sooner if everyone votes). The chair can close it early.`;
}

/** The case id in a handicap case's Feed link ('/tribunal/<id>'), or null. Newer cases ('/tribunal/case/<id>') aren't these. */
export function handicapCaseFromLink(link) {
  const m = /^\/tribunal\/([0-9a-f-]{36})$/i.exec(link || '');
  return m ? m[1] : null;
}

/** Is this Feed post a handicap verdict (new words, or the old "Verdict: …" ones)? */
export function isVerdictPost(body) {
  return /^(⚖️ (NOT )?GUILTY\b|Verdict: (NOT )?GUILTY\b)/.test(body || '');
}

/** For the organiser's "Move the closing time" box: a time as a datetime-local value, in this phone's time. */
export function toLocalInput(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
