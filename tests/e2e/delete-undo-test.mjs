// 7-day undo browser check (21 Oct 2026): Your groups lists a recently deleted group with "Bring back". Fake database.
// Usage: node delete-undo-test.mjs <signInBuildUrl> <shotDir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const SIGNIN = process.argv[2] || 'http://localhost:4302/';
const SHOTS = process.argv[3] || './shots-undo';
fs.mkdirSync(SHOTS, { recursive: true });
const Z = '00000000-0000-4000-8000-0000000fd000';
const calls = [];
let restored = false;
async function fake(route) {
  const req = route.request(); const url = new URL(req.url()); const m = req.method();
  const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(b) });
  if (m === 'OPTIONS') return json({});
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const name = url.pathname.split('/').pop(); calls.push(name);
    if (name === 'my_status') return json({ is_member: false, signed_in: true, groups: [] });
    if (name === 'my_deleted_groups') return json(restored ? [] : [{ id: Z, name: 'Test Group Z', deleted_at: '2026-10-20T10:00:00Z', undo_until: '2026-10-27T10:00:00Z' }]);
    if (name === 'undo_delete_group') { restored = true; return json(null); }
    return json(null);
  }
  if (url.pathname.startsWith('/auth/v1/user')) return json({ id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'zo@example.com' });
  return json([]);
}
const fails = []; const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
await ctx.route('https://*.supabase.co/**', fake);
await ctx.addInitScript(() => {
  const exp = Math.floor(Date.now() / 1000) + 86400; const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp, role: 'authenticated' })}.x`, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: 'u1', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'zo@example.com' } }));
  localStorage.setItem('tgt-whats-new', 'beta-1');
  sessionStorage.setItem('lgc-fresh-signin', '1');
});
const page = await ctx.newPage();
page.on('pageerror', (e) => fails.push(`page error: ${e}`));
await page.goto(`${SIGNIN}#/groups`);
let shown = false; try { await page.getByText('Deleted recently').waitFor({ timeout: 15000 }); shown = true; } catch { /* below */ }
if (!shown) { await page.goto(`${SIGNIN}#/`); try { await page.getByText('Deleted recently').waitFor({ timeout: 10000 }); shown = true; } catch { /* below */ } }
check(shown, 'Your groups lists the deleted group');
check(await page.getByText(/bring it back until/).isVisible().catch(() => false), 'says until when');
await page.screenshot({ path: `${SHOTS}/1-deleted-recently.png`, fullPage: true });
if (shown) { await page.getByRole('button', { name: 'Bring back' }).click(); await page.waitForTimeout(1500); }
check(calls.includes('undo_delete_group'), 'Bring back asks the database to restore it');
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nAll checks passed.');
process.exit(fails.length ? 1 : 0);
