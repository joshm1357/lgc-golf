// "Turn on notifications" pop-up and the notifications screen, browser check, 21 Oct 2026. Fake database and a
// fake phone (Notification / serviceWorker / PushManager stubbed with addInitScript) — nothing real is subscribed.
// Usage: node notify-prompt-test.mjs <base> <shotDir>   e.g. http://localhost:4379/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:4379/lgc-golf/';
const SHOTS = process.argv[3] || './shots-notify';
fs.mkdirSync(SHOTS, { recursive: true });

const GROUP = 'a0a0a0a0-0000-4000-8000-00000000000c';
const K = '11111111-1111-4111-8111-111111111111';
const UID = '99999999-9999-4999-8999-999999999999';
const now = '2026-10-21T08:00:00.000Z';
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};
const PROMPT_KEY = 'tgt-notify-prompt';

function freshDb({ notificationsOn = true } = {}) {
  return {
    players: [{ id: K, name: 'Kurt Dahl', nickname: 'Kurt', handicap: 12, approved: true, created_at: now }],
    trips: [], trophies: [], teams: [], team_players: [], quick_results: [], honour_board: [], round_pins: [], round_players: [], scores: [],
    courses: [], rounds: [], plans: [], plan_rsvps: [], posts: [], rules: [], push_subscriptions: [], notify_prefs: [],
    group_features: [
      { group_id: GROUP, feature_key: 'notifications', enabled: notificationsOn },
      { group_id: GROUP, feature_key: 'awards', enabled: true },
    ],
  };
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();

/** A phone: its own browser context, fake database and fake push. */
async function phone({ ua = UA.android, permission = 'default', db = freshDb(), lastShown = null, sub = null } = {}) {
  const log = { rpcs: [], notify: [] };
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ua });
  await ctx.route('https://*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-range': '0-0/*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    const p = url.pathname;
    if (p.startsWith('/functions/v1/notify')) { log.notify.push(JSON.parse(req.postData() || '{}').type); return json({ sent: 1 }); }
    if (p.startsWith('/rest/v1/rpc/my_status')) return json({ is_member: true, is_admin: false, player_id: K, group_name: 'Hunter Weekend', group_id: GROUP, role: 'player', legacy: false, groups: [{ id: GROUP, name: 'Hunter Weekend', slug: 'hunter', role: 'player' }] });
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.split('/').pop();
      const body = JSON.parse(req.postData() || '{}');
      log.rpcs.push(name);
      if (name === 'save_push_subscription') db.push_subscriptions.push({ endpoint: body.p_endpoint, user_id: UID, player_id: K });
      return json(null);
    }
    if (p.startsWith('/rest/v1/')) {
      const table = p.split('/')[3];
      const rows = db[table] || [];
      if (method === 'GET') {
        const out = rows.filter((r) => [...url.searchParams].every(([k, v]) => !v.startsWith('eq.') || k === 'group_id' || String(r[k]) === v.slice(3)));
        if (/vnd\.pgrst\.object/.test(req.headers().accept || '')) return out[0] ? json(out[0]) : json({ code: 'PGRST116', message: 'none' }, 406);
        return json(out);
      }
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        for (const b of Array.isArray(body) ? body : [body]) {
          const i = table === 'notify_prefs' ? rows.findIndex((r) => r.group_id === b.group_id) : -1;
          if (i >= 0) Object.assign(rows[i], b); else rows.push({ id: crypto.randomUUID(), ...b });
        }
        db[table] = rows;
        return json([], 201);
      }
      return json([], 200);
    }
    return json({});
  });
  await ctx.addInitScript(([uid, cfg]) => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated' } }));
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-caddie-hello', '1'); /* ov22: the hello is checked in hello-maps-test */
    if (cfg.lastShown != null && !sessionStorage.getItem('seeded')) { localStorage.setItem(cfg.key, String(cfg.lastShown)); sessionStorage.setItem('seeded', '1'); }
    // The fake phone: permission, a service worker and a push manager that remember a subscription for this tab.
    const st = JSON.parse(sessionStorage.getItem('fake-push') || 'null') || { permission: cfg.permission, sub: cfg.sub, requested: 0, subscribed: 0 };
    const save = () => sessionStorage.setItem('fake-push', JSON.stringify(st));
    window.__push = st;
    class FakeNotification {
      static get permission() { return st.permission; }
      static async requestPermission() { st.requested++; if (st.permission === 'default') st.permission = 'granted'; save(); return st.permission; }
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
    if (!('PushManager' in window)) window.PushManager = function PushManager() {};
    const mkSub = (endpoint) => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'p256', auth: 'auth' } }), unsubscribe: async () => { st.sub = null; save(); return true; } });
    const pushManager = {
      getSubscription: async () => (st.sub ? mkSub(st.sub) : null),
      subscribe: async () => { st.subscribed++; st.sub = 'https://push.example/fake-phone'; save(); return mkSub(st.sub); },
    };
    const reg = { pushManager, scope: '/' };
    const sw = { register: async () => reg, getRegistration: async () => reg, ready: Promise.resolve(reg), controller: null, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => sw, configurable: true });
  }, [UID, { permission, lastShown, sub, key: PROMPT_KEY }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { ctx, page, log, db };
}
const sheet = (page) => page.getByRole('dialog', { name: /Turn on notifications|Notifications are on/ });
const appears = (page, ms = 8000) => sheet(page).waitFor({ timeout: ms }).then(() => true, () => false);

// 1. Android, not set up: the sheet appears once after sign-in, with what you'll get and one-tap steps.
{
  const { ctx, page, log, db } = await phone();
  await page.goto(`${BASE}#/`);
  check(await appears(page), 'Android, not set up: the sheet appears after opening the group');
  const text = await sheet(page).innerText();
  check(/draw room/.test(text) && /Winners/.test(text), 'it says what you’ll get (draw room, winners)');
  check(/Tap “Allow” when Chrome asks/.test(text), 'Android steps: tap Turn on, then Allow');
  await page.screenshot({ path: `${SHOTS}/1-android-sheet.png` });
  await sheet(page).getByRole('button', { name: 'Not now' }).click();
  check(!(await sheet(page).isVisible().catch(() => false)), '"Not now" closes it');
  const saved = await page.evaluate((k) => localStorage.getItem(k), PROMPT_KEY);
  check(saved && Math.abs(Date.now() - Number(saved)) < 60_000, '"Not now" is remembered on this phone');
  await page.goto(`${BASE}#/more`);
  await page.reload();
  check(!(await appears(page, 4500)), 'not shown again straight away (once a week at most)');
  await page.goto(`${BASE}#/feed`);
  check(!(await appears(page, 3000)), 'not shown on the next screen either');

  // A week later: it asks again, and "Turn on" uses the real subscribe path, then points to the settings.
  await page.evaluate((k) => localStorage.setItem(k, String(Date.now() - 8 * 24 * 3600 * 1000)), PROMPT_KEY);
  await page.goto(`${BASE}#/`);
  await page.reload();
  check(await appears(page), 'a week later it asks again');
  await sheet(page).getByRole('button', { name: 'Turn on notifications' }).click();
  await page.getByText('Done ✓').waitFor({ timeout: 8000 }).catch(() => {});
  const push = await page.evaluate(() => window.__push);
  check(push.requested === 1 && push.subscribed === 1, 'Turn on asks permission and subscribes this phone');
  check(log.rpcs.includes('save_push_subscription') && db.push_subscriptions.length === 1, 'the phone is saved for me (save_push_subscription)');
  check(log.notify.includes('test'), 'a test buzz is asked for');
  check(await page.getByText('Done ✓').isVisible(), 'shows Done ✓');
  await page.screenshot({ path: `${SHOTS}/2-done.png` });
  await sheet(page).getByRole('button', { name: 'Choose what you get' }).click();
  await page.getByText('When you hear about things').waitFor({ timeout: 8000 }).catch(() => {});
  check(page.url().endsWith('#/notifications'), '"Choose what you get" opens the notifications screen');
  check(await page.getByText('Daily digest').isVisible() && await page.getByText('Only important').isVisible(), 'settings: straight away / daily digest / only important');
  check(!(await page.getByTestId('notify-banner').isVisible().catch(() => false)), 'no set-up banner once this phone is on');
  await page.getByRole('button', { name: /Daily digest/ }).click();
  await page.getByText('Send my digest at').waitFor({ timeout: 5000 }).catch(() => {});
  check(db.notify_prefs[0]?.mode === 'digest', 'picking Daily digest saves it');
  await page.screenshot({ path: `${SHOTS}/3-settings.png`, fullPage: true });
  await ctx.close();
}

// 2. The notifications screen itself: a banner with the same steps and Turn on button. And More points to it.
{
  const { ctx, page, log } = await phone({ lastShown: Date.now() });
  await page.goto(`${BASE}#/more`);
  await page.getByText('Turn them on, and choose what you get').waitFor({ timeout: 10000 });
  check(true, 'More has a "Notifications" row');
  await page.getByText('Turn them on, and choose what you get').click();
  await page.getByTestId('notify-banner').waitFor({ timeout: 8000 }).catch(() => {});
  check(await page.getByTestId('notify-banner').isVisible(), 'notifications screen: "this phone isn’t set up" banner');
  check(await page.getByText('When you hear about things').isVisible(), 'the when-you-hear choices are there before turning on too');
  await page.screenshot({ path: `${SHOTS}/4-banner.png`, fullPage: true });
  await page.getByTestId('notify-banner').getByRole('button', { name: 'Turn on notifications' }).click();
  await page.getByText('Done ✓').waitFor({ timeout: 8000 }).catch(() => {});
  check(log.rpcs.includes('save_push_subscription'), 'banner Turn on saves the phone');
  check(await page.getByText('Done ✓').isVisible() && !(await page.getByTestId('notify-banner').isVisible().catch(() => false)), 'banner gives way to Done ✓');
  check(!(await appears(page, 2500)), 'no pop-up on the notifications screen');
  await ctx.close();
}

// 3. iPhone in Safari (not on the Home Screen): Add to Home Screen steps, no Turn on button.
{
  const { ctx, page } = await phone({ ua: UA.iphone });
  await page.goto(`${BASE}#/`);
  check(await appears(page), 'iPhone in Safari: the sheet appears');
  const text = await sheet(page).innerText();
  check(/Add to Home Screen/.test(text) && /Share/.test(text) && /Got it/.test(text) && /16\.4/.test(text), 'iPhone steps: Share → Add to Home Screen (iOS 16.4+)');
  check(!(await sheet(page).getByRole('button', { name: 'Turn on notifications' }).isVisible().catch(() => false)), 'no Turn on button until it’s on the Home Screen');
  await page.screenshot({ path: `${SHOTS}/5-iphone.png` });
  await ctx.close();
}

// 4. Blocked before: how to unblock.
{
  const { ctx, page } = await phone({ permission: 'denied' });
  await page.goto(`${BASE}#/`);
  check(await appears(page), 'blocked phone: the sheet appears');
  check(/blocked/.test(await sheet(page).innerText()) && /Notifications → Allow/.test(await sheet(page).innerText()), 'blocked: steps to unblock in the browser settings');
  await page.screenshot({ path: `${SHOTS}/6-blocked.png` });
  await ctx.close();
}

// 5. Notifications switched off for the group: no sheet, no More row.
{
  const { ctx, page } = await phone({ db: freshDb({ notificationsOn: false }) });
  await page.goto(`${BASE}#/`);
  check(!(await appears(page, 5000)), 'group has notifications off: no sheet');
  await page.goto(`${BASE}#/more`);
  await page.getByText('My profile').waitFor({ timeout: 8000 });
  check(!(await page.getByText('Turn them on, and choose what you get').isVisible().catch(() => false)), 'group has notifications off: no Notifications row in More');
  await ctx.close();
}

// 6. Already set up on this phone: nothing.
{
  const db = freshDb();
  db.push_subscriptions.push({ endpoint: 'https://push.example/fake-phone', user_id: UID });
  const { ctx, page } = await phone({ permission: 'granted', db, sub: 'https://push.example/fake-phone' });
  await page.goto(`${BASE}#/`);
  check(!(await appears(page, 4500)), 'phone already set up for me: no sheet');
  // The same phone, but saved under an earlier sign-in (not me): asks.
  db.push_subscriptions.length = 0;
  await page.evaluate((k) => localStorage.removeItem(k), PROMPT_KEY);
  await page.reload();
  check(await appears(page), 'phone set up under someone else: asks me');
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
