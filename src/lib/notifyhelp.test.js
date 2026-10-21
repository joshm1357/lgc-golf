import { describe, it, expect } from 'vitest';
import { detectPhone, setupPlan, shouldPrompt, promptLastShown, markPromptShown, whatYouGet, WEEK_MS, PROMPT_KEY } from './notifyhelp.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneOld: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0]',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
};

describe('detectPhone', () => {
  it('knows an iPhone in Safari, not installed', () => {
    expect(detectPhone({ ua: UA.iphoneSafari })).toMatchObject({ os: 'ios', device: 'iPhone', browser: 'safari', installed: false, inApp: false, iosVersion: [17, 5] });
  });
  it('knows an installed iPhone app', () => {
    expect(detectPhone({ ua: UA.iphoneSafari, standalone: true }).installed).toBe(true);
  });
  it('knows Chrome on iPhone and an in-app browser', () => {
    expect(detectPhone({ ua: UA.iphoneChrome }).browser).toBe('chrome');
    expect(detectPhone({ ua: UA.iphoneMessenger }).inApp).toBe(true);
  });
  it('treats an iPad in desktop mode (Mac + touch) as iOS, and a real Mac as a computer', () => {
    expect(detectPhone({ ua: UA.ipadDesktop, platform: 'MacIntel', maxTouchPoints: 5 })).toMatchObject({ os: 'ios', device: 'iPad' });
    expect(detectPhone({ ua: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 })).toMatchObject({ os: 'desktop', browser: 'safari' });
  });
  it('knows Android browsers', () => {
    expect(detectPhone({ ua: UA.androidChrome })).toMatchObject({ os: 'android', browser: 'chrome' });
    expect(detectPhone({ ua: UA.androidSamsung })).toMatchObject({ os: 'android', browser: 'samsung' });
  });
  it('knows desktop browsers', () => {
    expect(detectPhone({ ua: UA.winChrome })).toMatchObject({ os: 'desktop', browser: 'chrome' });
    expect(detectPhone({ ua: UA.winEdge }).browser).toBe('edge');
    expect(detectPhone({ ua: UA.firefox }).browser).toBe('firefox');
  });
  it('copes with nothing', () => {
    expect(detectPhone()).toMatchObject({ os: 'desktop', browser: 'other', installed: false });
  });
});

describe('setupPlan', () => {
  const iphone = detectPhone({ ua: UA.iphoneSafari });
  it('iPhone in Safari: Add to Home Screen first, whatever the browser says', () => {
    for (const state of ['off', 'needs-home-screen', 'unsupported']) {
      const plan = setupPlan(iphone, state);
      expect(plan.step).toBe('home-screen');
      expect(plan.canTurnOn).toBe(false);
      expect(plan.steps.join(' ')).toMatch(/Add to Home Screen/);
      expect(plan.steps.join(' ')).toMatch(/Share/);
    }
  });
  it('iPhone in Chrome points at Chrome’s Share button', () => {
    expect(setupPlan(detectPhone({ ua: UA.iphoneChrome }), 'off').steps[0]).toMatch(/top right in Chrome/);
  });
  it('installed iPhone app: one tap and Allow', () => {
    const plan = setupPlan(detectPhone({ ua: UA.iphoneSafari, standalone: true }), 'off');
    expect(plan).toMatchObject({ step: 'turn-on', canTurnOn: true });
    expect(plan.steps[1]).toMatch(/Allow.*iPhone/);
  });
  it('old iOS: update first', () => {
    const plan = setupPlan(detectPhone({ ua: UA.iphoneOld }), 'needs-home-screen');
    expect(plan.step).toBe('update-ios');
    expect(plan.steps[0]).toMatch(/16\.3/);
  });
  it('installed iPhone app without notifications (version unknown): update', () => {
    expect(setupPlan(detectPhone({ ua: 'iPhone', standalone: true }), 'unsupported').step).toBe('update-ios');
  });
  it('Messenger’s built-in browser: open in Safari/Chrome first', () => {
    const plan = setupPlan(detectPhone({ ua: UA.iphoneMessenger }), 'unsupported');
    expect(plan.step).toBe('open-in-browser');
    expect(plan.title).toMatch(/Safari/);
  });
  it('Android Chrome: tap Turn on and Allow', () => {
    const plan = setupPlan(detectPhone({ ua: UA.androidChrome }), 'off');
    expect(plan).toMatchObject({ step: 'turn-on', canTurnOn: true });
    expect(plan.steps[1]).toMatch(/Allow.*Chrome/);
  });
  it('computer: Allow in the browser’s box', () => {
    const plan = setupPlan(detectPhone({ ua: UA.winChrome }), 'off');
    expect(plan.steps[0]).toMatch(/^Click/);
    expect(plan.steps[1]).toMatch(/Allow/);
  });
  it('blocked: how to unblock, per phone', () => {
    expect(setupPlan(detectPhone({ ua: UA.iphoneSafari, standalone: true }), 'blocked', 'L.G.C').steps.join(' ')).toMatch(/Settings.*Notifications, then L\.G\.C/);
    expect(setupPlan(detectPhone({ ua: UA.androidChrome }), 'blocked').steps.join(' ')).toMatch(/left of the web address/);
    expect(setupPlan(detectPhone({ ua: UA.androidChrome, standalone: true }), 'blocked').steps.join(' ')).toMatch(/App info/);
    expect(setupPlan(detectPhone({ ua: UA.macSafari }), 'blocked').steps.join(' ')).toMatch(/Safari → Settings → Websites/);
    expect(setupPlan(detectPhone({ ua: UA.firefox }), 'blocked').steps.join(' ')).toMatch(/Send notifications/);
    expect(setupPlan(detectPhone({ ua: UA.winChrome }), 'blocked')).toMatchObject({ step: 'blocked', canTurnOn: true });
  });
  it('unsupported browser on Android or a computer', () => {
    expect(setupPlan(detectPhone({ ua: UA.androidChrome }), 'unsupported').step).toBe('unsupported');
    expect(setupPlan(detectPhone({ ua: UA.winChrome }), 'unsupported').steps[0]).toMatch(/Chrome, Edge, Firefox or Safari/);
  });
  it('on: nothing to do', () => {
    expect(setupPlan(iphone, 'on').step).toBe('on');
  });
});

describe('shouldPrompt', () => {
  const base = { notificationsOn: true, step: 'turn-on', viewing: false, quick: false, offline: false, path: '/', lastShown: null, now: 1_000_000_000_000 };
  it('asks the first time', () => expect(shouldPrompt(base)).toBe(true));
  it('asks for the steps that can be done now', () => {
    expect(shouldPrompt({ ...base, step: 'home-screen' })).toBe(true);
    expect(shouldPrompt({ ...base, step: 'blocked' })).toBe(true);
    for (const step of ['on', 'unsupported', 'update-ios', 'open-in-browser']) expect(shouldPrompt({ ...base, step })).toBe(false);
  });
  it('not when the group has notifications off, viewing as someone, a quick round or no signal', () => {
    expect(shouldPrompt({ ...base, notificationsOn: false })).toBe(false);
    expect(shouldPrompt({ ...base, viewing: true })).toBe(false);
    expect(shouldPrompt({ ...base, quick: true })).toBe(false);
    expect(shouldPrompt({ ...base, offline: true })).toBe(false);
  });
  it('not while entering scores, on the notifications screen or joining', () => {
    expect(shouldPrompt({ ...base, path: '/score/abc' })).toBe(false);
    expect(shouldPrompt({ ...base, path: '/notifications' })).toBe(false);
    expect(shouldPrompt({ ...base, path: '/join/ABC' })).toBe(false);
    expect(shouldPrompt({ ...base, path: '/feed' })).toBe(true);
  });
  it('at most once a week', () => {
    expect(shouldPrompt({ ...base, lastShown: base.now - WEEK_MS + 1 })).toBe(false);
    expect(shouldPrompt({ ...base, lastShown: base.now - 60_000 })).toBe(false);
    expect(shouldPrompt({ ...base, lastShown: base.now - WEEK_MS })).toBe(true);
    expect(shouldPrompt({ ...base, lastShown: 'rubbish' })).toBe(true);
  });
});

describe('remembering on this phone', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
  it('saves and reads the time', () => {
    const s = mem();
    expect(promptLastShown(s)).toBe(null);
    markPromptShown(12345, s);
    expect(s.getItem(PROMPT_KEY)).toBe('12345');
    expect(promptLastShown(s)).toBe(12345);
  });
  it('never throws when storage is blocked', () => {
    const bad = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(promptLastShown(bad)).toBe(null);
    expect(() => markPromptShown(1, bad)).not.toThrow();
    expect(promptLastShown(null)).toBe(null);
  });
});

describe('whatYouGet', () => {
  it('lists the defaults for a new group (draw, trips, votes, jobs, money, rules, chat)', () => {
    const t = whatYouGet({}).map((x) => x.text).join(' | ');
    expect(t).toMatch(/draw room/);
    expect(t).toMatch(/day before/);
    expect(t).toMatch(/Votes/);
    expect(t).toMatch(/Jobs/);
    expect(t).toMatch(/owe/);
    expect(t).toMatch(/Rule changes up for a vote/);
    expect(t).not.toMatch(/Winners/); // awards is off by default
    expect(t).not.toMatch(/Rooms/);
  });
  it('follows the group’s switches', () => {
    const t = whatYouGet({ awards: true, draw: false, planner: false, rule_voting: false }).map((x) => x.text).join(' | ');
    expect(t).toMatch(/Winners/);
    expect(t).not.toMatch(/draw room/);
    expect(t).not.toMatch(/Votes|Jobs|trip/i);
    expect(t).toMatch(/Rule changes the organisers decide/);
  });
});
