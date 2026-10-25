// The link preview for a shared trip idea (ov39): what WhatsApp, Messenger and iMessage show under the link — a title,
// a line and the picture — and, for a person, a quick hop into the app.
//
// The app is one page with # addresses, so a link preview needs a real page on the server. On Cloudflare Pages that's
// functions/i/[token].js (a tiny page function, deployed with the site by the same `wrangler pages deploy`):
//   https://app.thegolftrip.club/i/<token>#/join/<code>?to=/idea/<id>
// The chat app fetches /i/<token> (it never sends the part after #) and reads the meta tags. A person's browser gets
// the same page, which sends them on to /#/join/<code>?to=/idea/<id> — the app's usual link (join first if needed).
// The page reads idea_preview(token) (108) with the public key: only the idea's name, rough when/where, who proposed
// it, the group's name and the picture. No token match → a plain "The Golf Trip" preview, and the hop still works.
// GitHub Pages (the current live address) can't run page functions: there the app shares the plain link, and the
// picture and the message are what people see.
// Pure — tested in ideapreview.test.js; the page function only does the fetching.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOKEN = /^[A-Za-z0-9_-]{16,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const okToken = (t) => TOKEN.test(String(t || ''));

// ------------------------------------------------------------------ ov42: what's asked, and by when (Sydney time)
// Josh (26 Oct): "There is an icon but nothing about what is requested. Why not 'Hunter trip vote' or something,
// 'closes x'." The title and line say the ask by stage — collecting (have your say by …), the vote (vote by …),
// decided (It's on: …). Counts only, never names (the link works with no sign-in). WhatsApp cuts titles at ~65.
export const TITLE_MAX = 65;
export const LINE_MAX = 150;
const TZ = 'Australia/Sydney';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…`; };

/** A moment's Sydney wall clock → { ymd, h, mi }. */
function sydneyParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), mi: Number(p.minute) };
}
/** Sydney wall time → a Date (daylight saving handled). */
export function sydneyAt(ymd, hh = 18, mm = 0) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const want = Date.UTC(y, mo - 1, d, hh, mm);
  let t = want - 10 * 3600000;
  for (let i = 0; i < 2; i++) { const p = sydneyParts(new Date(t)); const [py, pm, pd] = p.ymd.split('-').map(Number); t += want - Date.UTC(py, pm - 1, pd, p.h, p.mi); }
  return new Date(t);
}
const addDaysYmd = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const ymdDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const daysBetween = (a, b) => Math.round((ymdDate(b) - ymdDate(a)) / 86400000);

/** The default "have your say by": 4 days from now, 6pm Sydney. → Date */
export function defaultAnswerBy(now = new Date()) {
  return sydneyAt(addDaysYmd(sydneyParts(now).ymd, 4), 18, 0);
}

/** "Thu 6pm" / "Thu 6:30pm" (Sydney); a date alone → "Thu". More than 6 days off adds the date ("Thu 5 Nov 6pm"). */
export function shortWhen(at, now = new Date()) {
  if (!at) return '';
  const today = sydneyParts(now).ymd;
  let ymd; let clock = '';
  if (YMD.test(String(at))) ymd = String(at);
  else {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    const p = sydneyParts(d); ymd = p.ymd;
    const h12 = p.h % 12 || 12;
    clock = `${h12}${p.mi ? `:${String(p.mi).padStart(2, '0')}` : ''}${p.h < 12 ? 'am' : 'pm'}`;
  }
  const dd = ymdDate(ymd); const gap = daysBetween(today, ymd);
  const day = gap === 0 ? 'today' : gap === 1 ? 'tomorrow' : DOW[dd.getUTCDay()];
  const date = gap > 6 || gap < 0 ? ` ${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}` : '';
  return [`${day}${date}`, clock].filter(Boolean).join(' ');
}

/** "13–15 Mar" / "30 Oct – 1 Nov" / "13 Mar". */
export function shortDates(a, b) {
  if (!a || !YMD.test(String(a))) return '';
  const x = ymdDate(a); const y = b && YMD.test(String(b)) ? ymdDate(b) : x;
  if (+x === +y) return `${x.getUTCDate()} ${MON[x.getUTCMonth()]}`;
  if (x.getUTCMonth() === y.getUTCMonth()) return `${x.getUTCDate()}–${y.getUTCDate()} ${MON[y.getUTCMonth()]}`;
  return `${x.getUTCDate()} ${MON[x.getUTCMonth()]} – ${y.getUTCDate()} ${MON[y.getUTCMonth()]}`;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.round(Number(v))) : null);
const of = (n, m) => (n == null ? null : m ? `${n} of ${Math.max(m, n)}` : `${n}`);

/** The ask, by stage. p: idea_preview's answer (110 fields; an older answer reads as "collecting", no counts).
 *  → { stage, title, line, deadline ('Thu 6pm' | ''), headline (title without the emoji, for the picture) } */
export function ideaAsk(p, { now = new Date() } = {}) {
  const name = String(p?.name || 'Trip idea');
  const stage = ['collecting', 'vote', 'decided'].includes(p?.stage) ? p.stage : 'collecting';
  const fx = p?.fixed && typeof p.fixed === 'object' ? p.fixed : {};
  const fit = (emoji, before, after) => {
    const room = TITLE_MAX - (emoji.length + 1) - before.length - after.length;
    const head = `${before}${cut(name, Math.max(8, room))}${after}`;
    return { title: `${emoji} ${head}`, headline: head };
  };
  if (stage === 'vote') {
    const deadline = shortWhen(p.vote_closes, now);
    const open = Array.isArray(p.vote_open) ? p.vote_open : [];
    const what = open.includes('dates') && open.includes('location') ? 'When? and Where? are open' : open.includes('dates') ? 'When? is open' : open.includes('location') ? 'Where? is open' : 'The vote is open';
    const t = fit('🗳️', '', deadline ? `: vote by ${deadline}` : ': vote now');
    const cnt = of(num(p.voted), num(p.people));
    return { stage, ...t, deadline, line: cut(`${what}${cnt ? ` · ${cnt} voted` : ''}. One tap each.`, LINE_MAX) };
  }
  if (stage === 'decided') {
    const where = p.decided_where ? String(p.decided_where) : '';
    const dates = shortDates(p.decided_start, p.decided_end);
    const bits = [where, dates].filter(Boolean);
    const lead = bits.length ? bits.join(', ') : name;
    const head = `It’s on: ${cut(lead, TITLE_MAX - 11)}`;
    const n = num(p.in_count);
    return { stage, title: `✅ ${head}`, headline: head, deadline: '', line: `${n != null ? `${n} in so far. ` : ''}Say if you’re in.` };
  }
  const deadline = shortWhen(p?.answer_by, now);
  const t = fit('💡', '', deadline ? `: have your say by ${deadline}` : ': have your say');
  const when = fx.weekend?.start ? shortDates(fx.weekend.start, fx.weekend.end) : p?.when;
  const where = fx.area || p?.where;
  const tail = `${(() => { const c = of(num(p?.answered), num(p?.people)); return c ? ` ${c} have answered.` : ''; })()} Can you make it, budget, getting there, golf: 4 taps.`;
  const by = p?.by ? `${cut(p.by, 30)}’s trip idea` : 'A trip idea';
  const shape = [when, where].filter(Boolean).map((x) => String(x)).join(' · ');
  const room = LINE_MAX - by.length - tail.length - 4;
  const line = `${by}${shape && room > 6 ? ` · ${cut(shape, room)}` : ''}.${tail}`;
  return { stage, ...t, deadline, line: cut(line, LINE_MAX) };
}

/** The words for the preview. p: idea_preview's answer (or null). */
export function previewWords(p, { now = new Date() } = {}) {
  if (!p || !p.name) {
    return { title: 'A golf trip idea — The Golf Trip', description: 'Help plan it: 4 quick taps — your dates, budget, how you’d get there and what golf you’re after.' };
  }
  const a = ideaAsk(p, { now });
  return { title: a.title, description: a.line };
}

/** The whole page. { preview, url (this page), image (fallback picture), appBase ('/') } */
export function previewPage({ preview = null, url = '', image = '', appBase = '/' } = {}) {
  const w = previewWords(preview);
  const card = preview?.card_url && /^https:\/\//.test(preview.card_url) ? preview.card_url : null;
  const img = card || image;
  // v10.7.1: only the idea's own share card is 1200 × 630. The fallback is the square app icon — telling WhatsApp it's
  // 1200 × 630 made it drop the picture, so the fallback goes out with its real size as a small "summary" card.
  const size = card ? [1200, 630] : [512, 512];
  const planId = preview?.plan_id && UUID.test(preview.plan_id) ? preview.plan_id : null;
  const fallback = planId ? `#/idea/${planId}` : '#/';
  const base = /^\/[A-Za-z0-9/_-]*$/.test(appBase) ? appBase : '/';
  return `<!doctype html>
<html lang="en-AU"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(w.title)}</title>
<meta name="description" content="${esc(w.description)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="The Golf Trip" />
<meta property="og:title" content="${esc(w.title)}" />
<meta property="og:description" content="${esc(w.description)}" />
${url ? `<meta property="og:url" content="${esc(url)}" />\n` : ''}${img ? `<meta property="og:image" content="${esc(img)}" />\n<meta property="og:image:width" content="${size[0]}" />\n<meta property="og:image:height" content="${size[1]}" />\n<meta name="twitter:image" content="${esc(img)}" />\n` : ''}<meta name="twitter:card" content="${card ? 'summary_large_image' : 'summary'}" />
<meta name="robots" content="noindex" />
<style>body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#0E1F17;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}a{color:#E0B84A;font-weight:700}</style>
</head><body>
<div><p>${esc(w.title)}</p><p><a id="go" href="${esc(base + fallback)}">Open it in The Golf Trip</a></p></div>
<script>
(function () {
  var h = location.hash && location.hash.length > 2 ? location.hash : ${JSON.stringify(fallback)};
  if (!/^#\\/[A-Za-z0-9\\/_.~%=&?-]*$/.test(h)) h = ${JSON.stringify(fallback)};
  location.replace(${JSON.stringify(base)} + h);
})();
</script>
</body></html>`;
}

/** Wait at most `ms` for a promise; on time-out → `fallback` (never throws, never hangs). */
export function withTimeout(promise, ms, fallback = null) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), late]).finally(() => clearTimeout(timer));
}

/** How long the page waits for the database before sending the plain preview (ov42: a link went out with no card). */
export const PREVIEW_WAIT_MS = 1500;

/** The page function's work, with the fetching handed in (so it's testable). rpc may take an AbortSignal. A slow or
 *  failing lookup gives the plain preview straight away; the plain one is cached briefly (60 s) so repeat fetches by
 *  the chat app are instant, a real idea's for 5 minutes. */
export async function previewResponse({ token, url, rpc, image = '', timeoutMs = PREVIEW_WAIT_MS }) {
  let preview = null;
  if (okToken(token) && rpc) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    preview = await withTimeout((async () => rpc(token, ctl?.signal))(), timeoutMs, null);
    if (!preview) ctl?.abort();
    if (!preview || typeof preview !== 'object') preview = null;
  }
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': preview ? 'public, max-age=300' : 'public, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' },
    body: previewPage({ preview, url, image }),
  };
}
