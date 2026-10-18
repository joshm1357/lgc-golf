import { supabase } from './supabase.js';

// Stage 9: when the app breaks on someone's phone, it tells Josh (Josh's numbers → App problems). No outside service
// and nothing extra to install: the report goes to our own database. It sends the error message, where in the code
// it happened, the screen (without anything after '?', and never an invite code) and the app version — no names.

const IGNORE = /ResizeObserver loop|^Script error\.?$|Load failed|Failed to fetch|NetworkError|AbortError|aborted|cancell?ed|dynamically imported module|Importing a module script failed/i;
const MAX_PER_VISIT = 10;
const seen = new Set();

/** Should this message be sent? Not empty, not network noise, not already sent this visit, at most 10 a visit. */
export function worthReporting(message, already = seen, max = MAX_PER_VISIT) {
  const m = String(message || '').trim();
  return !!m && !IGNORE.test(m) && !already.has(m) && already.size < max;
}

/** The screen, without anything after '?', never an invite code, never a sign-in token. */
export function safePath(path) {
  return String(path || '').split('?')[0].split('#/join/')[0]
    .replace(/(access_token|refresh_token|provider_token|token_hash|error_description|code)=.*$/, '').slice(0, 200);
}

function appVersion() {
  try {
    const src = [...document.scripts].map((s) => s.src).find((s) => /\/index-[\w-]+\.js/.test(s)) || '';
    return (src.match(/\/index-([\w-]+)\.js/) || [])[1] || 'dev';
  } catch { return 'unknown'; }
}

export function reportProblem(err, where = '') {
  try {
    const message = String(err?.message || err || '').slice(0, 500);
    if (!worthReporting(message)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    seen.add(message);
    supabase.rpc('report_error', {
      p_message: message,
      p_stack: String(err?.stack || where || '').slice(0, 3000),
      p_path: safePath(`${window.location.pathname}${window.location.hash}`),
      p_version: appVersion(),
      p_agent: (navigator.userAgent || '').slice(0, 200),
    }).then(() => {}, () => {});
  } catch { /* never let reporting break the app */ }
}

/** Listen for crashes anywhere in the app (the live app only, not while building it). */
export function watchForProblems() {
  if (!import.meta.env.PROD || typeof window === 'undefined') return;
  window.addEventListener('error', (e) => reportProblem(e.error || e.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : ''));
  window.addEventListener('unhandledrejection', (e) => reportProblem(e.reason));
}
