// Helping people turn notifications on (21 Oct 2026). Pure logic only — the sheet is components/NotifyPrompt.jsx.
//
// Plain words:
//   - Which phone is this? iPhone/iPad, Android or a computer; which browser; is the app installed (opened from the
//     Home Screen) — worked out from the browser's own description of itself (the "user agent").
//   - What should this person do next? On an iPhone the app has to be on the Home Screen first (Apple only lets
//     installed web apps send notifications, iOS 16.4 or later). On Android and computers it's one tap and "Allow".
//     If they blocked notifications before, the steps say how to unblock them in the phone's or browser's settings.
//   - When to ask: once, then at most once a week while this phone still isn't set up. "Not now" is remembered on
//     this phone only.
//   - What they'll get: from the real kinds of notification the server sends (supabase/functions/notify), only for
//     features the group has switched on.
import { featureOn } from './features.js';

export const PROMPT_KEY = 'tgt-notify-prompt';
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** What a browser says about itself → { os: 'ios'|'android'|'desktop', device, browser, installed, inApp, iosVersion }. */
export function detectPhone({ ua = '', standalone = false, maxTouchPoints = 0, platform = '' } = {}) {
  // iPads in desktop mode say "Macintosh" but have a touch screen.
  const ios = /iphone|ipad|ipod/i.test(ua) || ((platform === 'MacIntel' || /Macintosh/.test(ua)) && maxTouchPoints > 1);
  const android = !ios && /android/i.test(ua);
  const browser = /SamsungBrowser/i.test(ua) ? 'samsung'
    : /Edg(A|iOS)?\//.test(ua) ? 'edge'
      : /Firefox|FxiOS/.test(ua) ? 'firefox'
        : /CriOS|Chrome|Chromium/.test(ua) ? 'chrome'
          : /Safari/.test(ua) ? 'safari' : 'other';
  // Messenger, Facebook and Instagram open links in their own little browser, which can't install apps or do
  // notifications. (Android's "; wv)" is any app's built-in web view.)
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|; wv\)/.test(ua);
  const m = ios ? ua.match(/OS (\d+)[_.](\d+)/) : null;
  const device = ios ? (/iphone|ipod/i.test(ua) ? 'iPhone' : 'iPad') : android ? 'Android' : 'computer';
  return { os: ios ? 'ios' : android ? 'android' : 'desktop', device, browser, installed: !!standalone, inApp, iosVersion: m ? [Number(m[1]), Number(m[2])] : null };
}

/** This phone, read from the real browser. Never throws. */
export function readPhone() {
  try {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    return detectPhone({ ua: navigator.userAgent || '', standalone, maxTouchPoints: navigator.maxTouchPoints || 0, platform: navigator.platform || '' });
  } catch {
    return detectPhone();
  }
}

const oldIos = (v) => !!v && (v[0] < 16 || (v[0] === 16 && v[1] < 4));
const APP = 'The Golf Trip';

/**
 * What to do next on this phone. `state` is from push.js myPushState():
 * 'unsupported' | 'needs-home-screen' | 'blocked' | 'off' | 'on'.
 * Returns { step, title, steps: [plain-words strings], canTurnOn, button }.
 *   step: 'on' | 'turn-on' | 'home-screen' | 'open-in-browser' | 'update-ios' | 'blocked' | 'unsupported'
 */
export function setupPlan(phone, state, appName = APP) {
  const p = phone || detectPhone();
  const tapOrClick = p.os === 'desktop' ? 'Click' : 'Tap';
  const dev = p.device === 'iPad' ? 'iPad' : 'iPhone';
  if (state === 'on') return { step: 'on', title: 'Notifications are on', steps: [], canTurnOn: false };
  // Inside Messenger/Facebook: nothing works here — open the page in the phone's real browser first.
  if (p.inApp && p.os !== 'desktop') {
    return {
      step: 'open-in-browser',
      title: `Open the app in ${p.os === 'ios' ? 'Safari' : 'Chrome'} first`,
      steps: [
        'You’re in an app’s built-in browser (like Messenger’s), which can’t do notifications.',
        `Tap the ⋯ or ⋮ menu and choose “Open in ${p.os === 'ios' ? 'Safari' : 'Chrome'}” (or “Open in browser”).`,
        'Then come back to this screen there.',
      ],
      canTurnOn: false,
    };
  }
  if (p.os === 'ios' && oldIos(p.iosVersion)) {
    return {
      step: 'update-ios',
      title: `Update your ${dev} first`,
      steps: [
        `Notifications need iOS 16.4 or later — this ${dev} is on ${p.iosVersion.join('.')}.`,
        'Open Settings → General → Software Update and install the update.',
        'Then add the app to your Home Screen and turn notifications on.',
      ],
      canTurnOn: false,
    };
  }
  // iPhone/iPad in Safari (or Chrome): Apple only allows notifications for apps on the Home Screen.
  if (p.os === 'ios' && !p.installed) {
    return {
      step: 'home-screen',
      title: 'First, add the app to your Home Screen',
      steps: [
        p.browser === 'safari' || p.browser === 'other'
          ? 'Tap the Share button (the square with an arrow pointing up) at the bottom of Safari.'
          : 'Tap the Share button (the square with an arrow pointing up — top right in Chrome, or in the browser’s menu).',
        'Scroll down and tap “Add to Home Screen”, then “Add”.',
        `Open ${appName} from its new icon on your Home Screen (not from the browser).`,
        'Tap “Turn on notifications”, then “Allow”.',
      ],
      note: 'Apple only lets apps on the Home Screen send notifications (iOS 16.4 or later).',
      canTurnOn: false,
    };
  }
  if (state === 'blocked') {
    let steps;
    if (p.os === 'ios') {
      steps = [`Open your ${dev}’s Settings app.`, `Tap Notifications, then ${appName}.`, 'Turn on “Allow Notifications”, then come back here.'];
    } else if (p.os === 'android' && p.installed) {
      steps = [`Press and hold the ${appName} icon on your home screen and tap “App info” (ⓘ).`, 'Tap Notifications and turn them on.', 'Come back here and tap “Turn on notifications”.'];
    } else if (p.os === 'android') {
      steps = ['Tap the icon to the left of the web address (🔒 or the sliders).', 'Tap Permissions (or Site settings) → Notifications → Allow.', 'Reload the page and tap “Turn on notifications”.'];
    } else if (p.browser === 'safari') {
      steps = ['In the menu bar, open Safari → Settings → Websites → Notifications.', 'Find this site and set it to Allow.', 'Reload the page and click “Turn on notifications”.'];
    } else if (p.browser === 'firefox') {
      steps = ['Click the icon to the left of the web address.', 'Next to “Send notifications”, click the ✕ to clear “Blocked”.', 'Reload the page and click “Turn on notifications”.'];
    } else {
      steps = ['Click the icon to the left of the web address (🔒 or the sliders).', 'Set Notifications to Allow.', 'Reload the page and click “Turn on notifications”.'];
    }
    return { step: 'blocked', title: 'Notifications are blocked on this phone', steps, canTurnOn: true, button: 'I’ve allowed them — turn on' };
  }
  if (state === 'unsupported' || state === 'needs-home-screen') {
    // An installed iPhone app with no notifications: iOS is too old (when the version couldn't be read).
    if (p.os === 'ios') {
      return { step: 'update-ios', title: `Update your ${dev} first`, steps: ['Notifications need iOS 16.4 or later.', 'Open Settings → General → Software Update and install the update.', 'Then open the app from your Home Screen and turn notifications on.'], canTurnOn: false };
    }
    return {
      step: 'unsupported',
      title: 'This browser can’t do notifications',
      steps: [p.os === 'android' ? 'Open the app in Chrome, then turn notifications on there.' : 'Try Chrome, Edge, Firefox or Safari, then turn notifications on there.'],
      canTurnOn: false,
    };
  }
  // 'off': one tap and Allow.
  return {
    step: 'turn-on',
    title: 'Turn on notifications',
    steps: [
      `${tapOrClick} “Turn on notifications” below.`,
      p.os === 'ios' ? `Tap “Allow” when your ${dev} asks.`
        : p.os === 'android' ? `Tap “Allow” when ${p.browser === 'samsung' ? 'your browser' : 'Chrome'} asks.`
          : 'Click “Allow” in the box your browser shows (near the web address).',
    ],
    canTurnOn: true,
  };
}

/** Steps worth a pop-up: something the person can actually do now. */
const PROMPT_STEPS = new Set(['turn-on', 'home-screen', 'blocked']);

/**
 * Should the "turn on notifications" sheet show now?
 * Not when: the group has notifications off, an organiser is viewing as someone, a quick round, no signal, entering
 * scores, already on the notifications screen, nothing this phone can do, or it was shown in the last week.
 */
export function shouldPrompt({ notificationsOn, step, viewing, quick, offline, path = '/', lastShown = null, now = Date.now() }) {
  if (!notificationsOn || viewing || quick || offline) return false;
  if (path.startsWith('/score/') || path === '/notifications' || path.startsWith('/join/')) return false;
  if (!PROMPT_STEPS.has(step)) return false;
  if (lastShown == null || !Number.isFinite(Number(lastShown))) return true;
  return now - Number(lastShown) >= WEEK_MS;
}

/** When the sheet was last shown on this phone (ms), or null. */
export function promptLastShown(store = safeLocal()) {
  try {
    const v = Number(store?.getItem(PROMPT_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}
export function markPromptShown(now = Date.now(), store = safeLocal()) {
  try { store?.setItem(PROMPT_KEY, String(now)); } catch { /* private browsing: it may ask again next time */ }
}
function safeLocal() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * What you'll get, in plain words — from the kinds the notify server function sends, for features that are on.
 * `features` is the group's { key: true/false } map (missing = the default).
 */
export function whatYouGet(features = {}) {
  const on = (k) => featureOn(k, features);
  return [
    on('draw') && { icon: '🎲', text: 'The draw room opening — watch the teams drawn live' },
    on('awards') && { icon: '🏆', text: 'Winners, as soon as a round, side comp or trophy is decided' },
    on('planner') && { icon: '⛳', text: 'Your trip: a heads-up the week before and the day before' },
    on('planner') && { icon: '🗓️', text: 'New trips and ideas — say if you’re in' },
    on('planner_tasks') && { icon: '🗳️', text: 'Votes opening, and a reminder the day before they close' },
    on('planner_tasks') && { icon: '📋', text: 'Jobs given to you, and a reminder the day before they’re due' },
    on('planner_costs') && { icon: '💰', text: 'Money: what you owe, and when someone says they’ve paid you' },
    on('planner_rooms') && { icon: '🛏️', text: 'Rooms and cars — who you’re with' },
    { icon: '📜', text: on('rule_voting') ? 'Rule changes up for a vote, and what was decided' : 'Rule changes the organisers decide' },
    on('planner') && { icon: '💬', text: 'New messages on your trips' },
  ].filter(Boolean);
}
