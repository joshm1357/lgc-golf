// Deno tests for the email sender (079): nothing goes without the key; the Resend request is the right shape.
// Fake fetch only — no real email is sent.
import nodeAssert from 'node:assert/strict';
import { sendEmail, resendRequest, RESEND_URL, normaliseFrom } from './email.ts';

const env = (vals: Record<string, string>) => ({ get: (k: string) => vals[k] });
const msg = { to: 'mike@example.com', subject: '🗳️ Hunter: Which weekend?', html: '<p>Hi</p>', text: 'Hi', unsubscribe: 'https://app.thegolftrip.club/#/v/t?stop=1' };

Deno.test('no key (or no from address): skipped as "email not set up", nothing fetched', async () => {
  let calls = 0;
  const fake = (() => { calls++; return Promise.resolve(new Response('{}')); }) as typeof fetch;
  nodeAssert.deepEqual(await sendEmail(msg, env({}), fake), { ok: false, skipped: 'email not set up' });
  nodeAssert.deepEqual(await sendEmail(msg, env({ RESEND_API_KEY: 'k' }), fake), { ok: false, skipped: 'email not set up' });
  nodeAssert.equal(calls, 0);
});

Deno.test('with the key: one POST to Resend with from, to, subject, html, text and an unsubscribe header', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fake = ((url: string, init: RequestInit) => { seen.push({ url, init }); return Promise.resolve(new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })); }) as unknown as typeof fetch;
  const r = await sendEmail(msg, env({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'The Golf Trip <votes@thegolftrip.club>' }), fake);
  nodeAssert.deepEqual(r, { ok: true, id: 'em_1' });
  nodeAssert.equal(seen.length, 1);
  nodeAssert.equal(seen[0].url, RESEND_URL);
  nodeAssert.equal(seen[0].init.method, 'POST');
  nodeAssert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer re_test');
  const body = JSON.parse(String(seen[0].init.body));
  nodeAssert.deepEqual(body, { from: 'The Golf Trip <votes@thegolftrip.club>', to: ['mike@example.com'], subject: msg.subject, html: msg.html, text: msg.text, headers: { 'List-Unsubscribe': `<${msg.unsubscribe}>` } });
});

Deno.test('Resend says no, or the network fails: reported, not thrown, and the key never appears', async () => {
  const bad = (() => Promise.resolve(new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 }))) as typeof fetch;
  const r = await sendEmail(msg, env({ RESEND_API_KEY: 're_secret', EMAIL_FROM: 'x <a@b.co>' }), bad);
  nodeAssert.equal(r.ok, false);
  nodeAssert.match((r as { error: string }).error, /403/);
  nodeAssert.ok(!JSON.stringify(r).includes('re_secret'));
  const down = (() => Promise.reject(new Error('offline'))) as typeof fetch;
  nodeAssert.equal((await sendEmail(msg, env({ RESEND_API_KEY: 'k', EMAIL_FROM: 'x <a@b.co>' }), down)).ok, false);
});

Deno.test('request builder has no unsubscribe header when none is given', () => {
  const { init } = resendRequest({ ...msg, unsubscribe: undefined }, 'a <a@b.co>', 'k');
  nodeAssert.deepEqual(JSON.parse(String(init.body)).headers, {});
});

Deno.test('EMAIL_FROM: missing angle brackets are put back; good values are left alone', () => {
  const eq = (a: string, b: string) => { if (a !== b) throw new Error(`${a} !== ${b}`); };
  eq(normaliseFrom('The Golf Trip votes@thegolftrip.club'), 'The Golf Trip <votes@thegolftrip.club>');
  eq(normaliseFrom('The Golf Trip <votes@thegolftrip.club>'), 'The Golf Trip <votes@thegolftrip.club>');
  eq(normaliseFrom(' votes@thegolftrip.club '), 'votes@thegolftrip.club');
  eq(normaliseFrom('"The Golf Trip, votes@thegolftrip.club"'), 'The Golf Trip <votes@thegolftrip.club>');
  eq(normaliseFrom(''), '');
});
