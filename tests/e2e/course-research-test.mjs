// Course research on the course page (088, ov17), 22 Oct 2026. Fake database only — nothing real is touched.
// #/c/<slug>: "About this course for groups" (style, fees, visitor and member times, how to book with the booking /
// enquiry links, stay-and-play, good for groups ★, "Researched … — check with the club", sources) — on a course with
// a scorecard and on a listing with none. No research → no block; not signed in → no block. 375 px and 1280 px.
// Usage: node course-research-test.mjs <base> <shotDir>   e.g. http://localhost:4389/lgc-golf/
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4389/lgc-golf/';
const SHOTS = process.argv[3] || './shots-course-research';
fs.mkdirSync(SHOTS, { recursive: true });

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: [3, 4, 5][i % 3], si: i + 1 }));
const COURSES = {
  'the-vintage-golf-club': { id: '11111111-0000-4000-8000-000000000001', slug: 'the-vintage-golf-club', name: 'The Vintage Golf Club', area: 'Pokolbin NSW', holes, osm: false, verified: false },
  'zzq-listing-links': { id: '11111111-0000-4000-8000-000000000002', slug: 'zzq-listing-links', name: 'Bermagui Country Club', area: 'Bermagui NSW', holes: [], osm: false, verified: false },
  'no-research-gc': { id: '11111111-0000-4000-8000-000000000003', slug: 'no-research-gc', name: 'No Research GC', area: 'Somewhere NSW', holes, osm: false, verified: false },
};
const research = [
  { library_id: COURSES['the-vintage-golf-club'].id, name: 'The Vintage Golf Club', town: 'Pokolbin', state: 'NSW', fee_weekday: 150, fee_weekend: 180, access_type: 'public',
    good_for_groups: 5, drive_from_sydney_hours: 2.25, booking_url: 'https://thevintage.miclub.com.au/cms/', group_enquiry_url: 'https://thevintagegolfclub.com.au/groups',
    phone: '(02) 4998 6789 (pro shop)', email: 'golf@thevintage.example', last_checked: '2026-10-01',
    sources: ['https://www.thevintagegolfclub.com.au/', 'https://www.planetgolf.com/rankings/australia/golf-australia-top-100/2026'],
    details: { style: 'parkland, resort', difficulty: '4 - Greg Norman design, water on 8 holes', rankings: 'GA Top 100 2026: #60; AGD 2026: #60',
      members_times: 'Wed and Sat mornings are member comps until about 11:30am (club site, Oct 2026)', visitor_times: 'Public 7 days; Sat after 11:30am',
      access_route: 'Book online; Chateau Elan guests use their booking number', stay_and_play: 'Chateau Elan at The Vintage — 2 nights + golf packages',
      good_for_groups: '5 - rooms on site, public 7 days', group_bookings_how: 'Golf shop for 12+ (golf@thevintage.example)', twilight_or_group_rates: 'Groups of 12+: ask for the group rate' } },
  { library_id: COURSES['zzq-listing-links'].id, name: 'Bermagui Country Club', town: 'Bermagui', state: 'NSW', fee_weekday: 55, fee_weekend: 55, access_type: 'public',
    group_enquiry_url: 'https://www.bermaguicountryclub.com/golf', phone: '02 6493 4340 (club); pro shop 02 6493 4657', last_checked: '2026-10-01', sources: ['https://www.golfnsw.org.au/x'],
    details: { style: 'coastal', members_times: 'Comp days Tue, Wed, Thu, Sat (mornings)', visitor_times: 'Visitors welcome 7 days' } },
];

let reads = 0;
async function fake(route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return json({});
  const p = url.pathname;
  if (p === '/rest/v1/rpc/course_page') return json(COURSES[JSON.parse(req.postData() || '{}').p_slug] || null);
  if (p === '/rest/v1/rpc/my_status') return json({ is_member: false, groups: [] });
  if (p.startsWith('/rest/v1/rpc/')) return json(null);
  if (p === '/rest/v1/course_research') {
    reads++;
    const ids = (url.searchParams.get('library_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, ''));
    return json(research.filter((r) => ids.includes(r.library_id)));
  }
  if (p.startsWith('/rest/v1/')) return json([]);
  if (p.startsWith('/auth/v1/')) return json({});
  return json({});
}

const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
const browser = await chromium.launch();
async function open(width, signedIn) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 812 : 900 }, deviceScaleFactor: width < 500 ? 2 : 1, isMobile: width < 500, hasTouch: width < 500 });
  await ctx.route('https://*.supabase.co/**', fake);
  await ctx.route('https://server.arcgisonline.com/**', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.addInitScript(([uid, on]) => {
    localStorage.setItem('tgt-whats-new', 'beta-1'); localStorage.setItem('tgt-notify-prompt', String(Date.now()));
    if (!on) return;
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, exp, role: 'authenticated' })}.x`;
    if (!localStorage.getItem('lgc-auth')) localStorage.setItem('lgc-auth', JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user: { id: uid, aud: 'authenticated', role: 'authenticated', is_anonymous: true } }));
  }, ['99999999-9999-4999-8999-999999999999', signedIn]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`page error: ${e}`));
  return { ctx, page };
}

// 1. A course with a scorecard, signed in, phone width.
{
  const { ctx, page } = await open(375, true);
  await page.goto(`${BASE}#/c/the-vintage-golf-club`);
  const about = page.getByTestId('about-groups');
  await about.waitFor({ timeout: 15000 });
  const t = await about.innerText();
  check(t.startsWith('About this course for groups'), 'the block has its title');
  check(t.includes('Style: parkland, resort · Greg Norman design, water on 8 holes'), 'style and difficulty (the "4 -" score left off)');
  check(t.includes('Fees: $150 weekdays · $180 weekends. Groups of 12+: ask for the group rate'), 'fees, weekday and weekend, and the group rate');
  check(t.includes('Visitor times: Public 7 days; Sat after 11:30am'), 'visitor times');
  check(t.includes('Members have: Wed and Sat mornings are member comps until about 11:30am') && !t.includes('club site, Oct 2026'), 'member times, source note trimmed');
  check(t.includes('Getting a game: Public — anyone can book. Book online; Chateau Elan guests use their booking number'), 'how a group gets a game');
  check(t.includes('How to book: Golf shop for 12+'), 'how to book');
  check(t.includes('Stay and play: Chateau Elan at The Vintage'), 'stay and play');
  check(t.includes('Good for groups: ★★★★★ rooms on site, public 7 days'), 'good for groups in stars, with the reason');
  check(t.includes('Researched Oct 2026 — check with the club'), '"Researched Oct 2026 — check with the club"');
  check(await about.getByRole('link', { name: 'Book online ↗' }).getAttribute('href') === 'https://thevintage.miclub.com.au/cms/', 'the booking link');
  check(await about.getByRole('link', { name: 'Group enquiry ↗' }).getAttribute('href') === 'https://thevintagegolfclub.com.au/groups', 'the group enquiry link');
  check(await about.getByRole('link', { name: /02\) 4998 6789/ }).getAttribute('href') === 'tel:0249986789', 'the phone dials');
  await about.getByTestId('about-sources-btn').click();
  check(await about.getByTestId('about-sources').locator('a').count() === 2, 'sources list: 2 links');
  const box = await about.boundingBox();
  check(box && box.width <= 375, `fits the phone (${box?.width})`);
  check(await page.getByText(/18 holes · par \d+/).count() === 1, 'the course page still has its scorecard');
  await about.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/course-page-375.png`, fullPage: true });
  await ctx.close();
}

// 2. A listing with no scorecard: the research is what makes the page useful.
{
  const { ctx, page } = await open(375, true);
  await page.goto(`${BASE}#/c/zzq-listing-links`);
  const about = page.getByTestId('about-groups');
  await about.waitFor({ timeout: 15000 });
  const t = await about.innerText();
  check(t.includes('Fees: $55 (18 holes)') && t.includes('Members have: Comp days Tue, Wed, Thu, Sat (mornings)'), 'listing: fees and member times');
  check(await page.getByText('No scorecard yet').count() === 1, 'listing: still says no scorecard yet');
  check(await about.getByRole('link', { name: 'Book online ↗' }).count() === 0, 'no booking link when there isn’t one (nothing made up)');
  await page.screenshot({ path: `${SHOTS}/course-page-listing-375.png`, fullPage: true });
  await ctx.close();
}

// 3. No research → no block. Not signed in → no block (and nothing read).
{
  const { ctx, page } = await open(375, true);
  await page.goto(`${BASE}#/c/no-research-gc`);
  await page.getByText(/18 holes · par \d+/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  check(await page.getByTestId('about-groups').count() === 0, 'no research → no block');
  await ctx.close();
}
{
  const before = reads;
  const { ctx, page } = await open(375, false);
  await page.goto(`${BASE}#/c/the-vintage-golf-club`);
  await page.getByText(/18 holes · par \d+/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  check(await page.getByTestId('about-groups').count() === 0 && reads === before, 'not signed in → no block, nothing read (signed-in reference data)');
  await ctx.close();
}

// 4. Laptop width.
{
  const { ctx, page } = await open(1280, true);
  await page.goto(`${BASE}#/c/the-vintage-golf-club`);
  await page.getByTestId('about-groups').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/course-page-1280.png`, fullPage: true });
  check(true, 'laptop width renders');
  await ctx.close();
}

await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED:\n${fails.join('\n')}`); process.exit(1); }
console.log('All checks passed.');
