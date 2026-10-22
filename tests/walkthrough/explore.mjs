// Scratch: open a screen as one person and try something (used while writing the walkthrough). Not part of the run.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { makeServer, personBrowser, GROUP } from './fake.mjs';
import { makeWorld, addPeople, LIBRARY, holes } from './fixtures.mjs';
import { OUT, BASE } from './shoot.mjs';
import fs from 'node:fs';

const db = makeWorld({ extraFeatures: ['cup'] });
db.cup_sides.push({ id: 'a1a1a1a1-0000-4000-8000-000000000001', group_id: GROUP, name: 'Team Blue', colour: '#1f4ea8', sort: 0 }, { id: 'a1a1a1a1-0000-4000-8000-000000000002', group_id: GROUP, name: 'Team Red', colour: '#b3261e', sort: 1 });
const S = makeServer(db, { library: LIBRARY, holes });
const P = addPeople(S);
const browser = await chromium.launch();
fs.mkdirSync(`${OUT}/_explore`, { recursive: true });
const { ctx, page } = await personBrowser(browser, S, P.organiser, { width: 1440 });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto(`${BASE}#/cup`); await page.waitForTimeout(2500);
await page.getByRole('button', { name: /Set up the cup/ }).click(); await page.waitForTimeout(800);
const t = page.getByRole('button', { name: /Who’s on which team/ });
console.log('toggle count', await t.count());
await t.click(); await page.waitForTimeout(800);
const rows = await page.locator('div.row').allInnerTexts();
console.log(rows.filter((r) => r.includes('(')).slice(0, 5));
const row = page.locator('div.row').filter({ hasText: /\bKurt|\bJosh \(/ }).first();
console.log('row', await row.count(), await row.innerText().catch(() => ''));
await ctx.close(); await browser.close();
