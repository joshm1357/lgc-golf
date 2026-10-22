// Screenshot bookkeeping for the walkthrough: numbered full-page shots per scenario, one neutral manifest line each,
// and builder notes (console errors, page errors, things that couldn't be reached).
import fs from 'node:fs';
import path from 'node:path';

export const OUT = process.env.WT_OUT || '/tmp/claude-0/-home-claude/d44ea5c1-88ec-5a37-9af3-bb8608240fba/scratchpad/walkthrough';
export const BASE = process.env.WT_BASE || 'http://localhost:4330/lgc-golf/';

/** Sydney's today, as the app sees it. */
export const sydneyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
export const plusDays = (n, from = sydneyToday()) => {
  const [y, m, d] = from.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
export const wait = (page, ms = 600) => page.waitForTimeout(ms);

export function recorder(scenario, title) {
  const dir = path.join(OUT, scenario);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const R = { scenario, title, dir, shots: [], notes: [], n: 0, errors: [] };
  /** Watch a page for errors (they go in the builder notes with the shot they happened near). */
  R.watch = (page, who) => {
    page.on('pageerror', (e) => R.errors.push({ who, at: R.n, text: `page error: ${String(e).slice(0, 300)}` }));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Failed to load resource|ERR_|net::|WebSocket|websocket/i.test(t)) return; // the fake answers some addresses with nothing on purpose
      R.errors.push({ who, at: R.n, text: `console: ${t.slice(0, 300)}` });
    });
  };
  /** One shot. stage: short slug; role: organiser|keen|quiet|late|guest|…; line: who is looking and what they just did. */
  R.shot = async (page, stage, role, line, { full = true } = {}) => {
    R.n += 1;
    const w = page.viewportSize().width;
    const file = `${String(R.n).padStart(2, '0')}-${stage}-${role}-${w}.png`;
    await page.waitForTimeout(350);
    // Full page, with the bars that stick to the screen (sidebar, tab bar, caddie button) pinned to the page instead,
    // so they sit where a person would see them rather than floating mid-picture. A sheet or pop-up that's open is
    // taken as the screen shows it.
    const sheetOpen = await page.locator('.sheet-bg, [role="dialog"]').first().isVisible().catch(() => false);
    const whole = full && !sheetOpen;
    if (whole) {
      await page.addStyleTag({ content: `html, body { position: relative; } body { min-height: 100vh; }
        .side { position: absolute !important; bottom: 0 !important; }
        .tabs { position: absolute !important; bottom: 0 !important; }
        .caddie-btn { position: absolute !important; }
        .toast { position: absolute !important; }` }).then((h) => h.evaluate((el) => el.setAttribute('data-wt', '1'))).catch(() => {});
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: path.join(dir, file), fullPage: whole }).catch(async (e) => {
      R.notes.push(`Shot ${file}: capture failed (${String(e).slice(0, 120)}).`);
    });
    if (whole) await page.evaluate(() => document.querySelectorAll('style[data-wt]').forEach((x) => x.remove())).catch(() => {});
    R.shots.push({ file, line });
    console.log(`  ${file}  ${line}`);
    return file;
  };
  R.note = (text) => { R.notes.push(text); console.log(`  NOTE: ${text}`); };
  /** Try a step; if the screen isn't there, note it and carry on. */
  R.try = async (label, fn) => {
    try { return await fn(); } catch (e) { R.note(`Couldn’t ${label}: ${String(e.message || e).split('\n')[0].slice(0, 200)}`); return null; }
  };
  R.save = () => fs.writeFileSync(path.join(dir, '_result.json'), JSON.stringify({ scenario, title, shots: R.shots, notes: R.notes, errors: R.errors }, null, 2));
  return R;
}
