// Golf courses have patchy signal. Score saves queue on the phone and send when signal returns.
import { supabase } from './supabase.js';
import { previewOf, READ_ONLY_MESSAGE } from './preview.js';

const KEY = 'lgc-score-queue';
const listeners = new Set();

// The queue is kept in memory as well as on the phone, so a save is never lost even if
// phone storage is full or blocked (it then lasts until the app is closed).
let mem = null;
function read() {
  if (mem) return mem;
  try {
    mem = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    mem = [];
  }
  return mem;
}

/** Storage full? Throw away the saved offline copies (they refill on the next load) — never the score queue. */
export function freeCacheSpace() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('lgc-cache-')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

function write(q) {
  mem = q;
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    freeCacheSpace();
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* still kept in memory */ }
  }
  listeners.forEach((fn) => fn(q));
}

export function pendingScores() {
  return read();
}

export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const keyOf = (r) => `${r.round_id}|${r.subject_id}|${r.hole}`;

/** Save a score: try now, queue if it fails. Returns true if it reached the server. */
export async function saveScore(row) {
  // Viewing as a player is read only: never queue a score that would later send as the organiser.
  const viewing = previewOf();
  if (viewing) throw new Error(READ_ONLY_MESSAGE(viewing.name));
  // Replace any queued version of the same hole.
  const q = read().filter((r) => keyOf(r) !== keyOf(row));
  write([...q, { ...row, queued_at: new Date().toISOString() }]);
  return flush();
}

// Only database rule/constraint/data errors are permanent. Everything else
// (no signal — e.g. Safari's "Load failed" — timeouts, server hiccups, expired login) is kept and retried.
const isPermanent = (error) => /^(42|23|22)/.test(error?.code || '');
const strip = ({ queued_at, ...r }) => r; // eslint-disable-line no-unused-vars

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const c = new AbortController(); // older iPhones
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

function upsert(rows) {
  return supabase.from('scores')
    .upsert(rows, { onConflict: 'round_id,subject_id,hole' })
    .abortSignal(timeoutSignal(10000));
}

function removeSent(sentRows) {
  // Remove only what we sent — a newer save of the same hole may have arrived meanwhile.
  const sentAt = new Map(sentRows.map((r) => [keyOf(r), r.queued_at]));
  write(read().filter((r) => !sentAt.has(keyOf(r)) || r.queued_at > sentAt.get(keyOf(r))));
}

// One send at a time; a save that arrives mid-send waits its turn, then sends.
let current = null;
export async function flush() {
  while (current) {
    try { await current; } catch { /* the earlier send's problem, not ours */ }
  }
  current = doFlush();
  try {
    return await current;
  } finally {
    current = null;
  }
}

async function doFlush() {
  let ok = false;
  let rejected = null;
  try {
    const q = read();
    if (!q.length) return true;
    let error;
    try {
      ({ error } = await upsert(q.map(strip)));
    } catch (e) {
      error = { message: String(e?.message || e), code: '' };
    }
    if (!error) {
      removeSent(q);
      ok = true;
    } else if (isPermanent(error)) {
      // Send one at a time so one bad row (e.g. a locked round) doesn't sink the good ones.
      for (const row of q) {
        let e1;
        try {
          ({ error: e1 } = await upsert([strip(row)]));
        } catch (e) {
          e1 = { code: '' };
        }
        if (!e1 || isPermanent(e1)) {
          removeSent([row]);
          if (e1) rejected = e1;
        }
      }
      ok = !read().length;
    }
    if (rejected) throw rejected;
    return ok;
  } finally {
    // A newer save may have arrived while we were sending.
    if (ok && read().length) setTimeout(() => flush().catch(() => {}), 0);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flush().catch(() => {}));
  setInterval(() => {
    if (read().length) flush().catch(() => {});
  }, 15000);
}
