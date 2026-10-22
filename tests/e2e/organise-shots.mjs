// Before / after screenshots of a trip's page (Overview and Organise) for the three trip shapes in
// organise-fixtures.mjs, on a laptop (1440×900) and a phone (375). Fake database only.
// Usage: node tests/e2e/organise-shots.mjs <base> <shotDir> <prefix: before|after>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { makeDb, fakeSupabase, fakeContext, PA, PB, PC, pid } from './organise-fixtures.mjs';

const BASE = process.argv[2] || 'http://localhost:4401/lgc-golf/';
const SHOTS = process.argv[3] || './organise-shots';
const PREFIX = process.argv[4] || 'after';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const trips = [['a-new', PA], ['b-demo', PB], ['c-locked', PC]];
const extraTabs = { 'b-demo': ['vote', 'chat'], 'c-locked': ['jobs', 'kitty', 'people'] };
for (const [device, size] of [['desktop', { width: 1440, height: 900, mobile: false }], ['phone', { width: 375, height: 812, mobile: true }]]) {
  const db = makeDb();
  const fake = fakeSupabase(db);
  const ctx = await fakeContext(browser, fake, size);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${device}: ${e}`));
  for (const [name, id] of trips) {
    for (const view of ['overview', 'organise']) {
      await page.goto(`${BASE}#/plan/${id}?view=${view}`);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${SHOTS}/${PREFIX}-${name}-${view}-${device}.png`, fullPage: true });
    }
    if (device === 'desktop') {
      for (const tab of extraTabs[name] || []) {
        await page.goto(`${BASE}#/plan/${id}?view=organise&tab=${tab}`);
        await page.waitForTimeout(1400);
        await page.screenshot({ path: `${SHOTS}/${PREFIX}-${name}-organise-${tab}-${device}.png`, fullPage: true });
      }
    }
  }
  await ctx.close();
}
// A player (Bo, hasn't voted) on the demo trip: the Overview with the vote front and centre.
{
  const db = makeDb();
  const fake = fakeSupabase(db, () => ({ id: pid(4), admin: false }));
  for (const [device, size] of [['desktop', { width: 1440, height: 900, mobile: false }], ['phone', { width: 375, height: 812, mobile: true }]]) {
    const ctx = await fakeContext(browser, fake, size);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`player ${device}: ${e}`));
    await page.goto(`${BASE}#/plan/${PB}`);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${SHOTS}/${PREFIX}-b-demo-player-default-${device}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
console.log(fs.readdirSync(SHOTS).filter((f) => f.startsWith(PREFIX)).join('\n'));
