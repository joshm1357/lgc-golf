// Golf courses have patchy signal. Score saves queue on the phone and send when signal returns.
import { supabase } from './supabase.js';

const KEY = 'lgc-score-queue';
const listeners = new Set();

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function write(q) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
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
  // Replace any queued version of the same hole.
  const q = read().filter((r) => keyOf(r) !== keyOf(row));
  write([...q, { ...row, queued_at: new Date().toISOString() }]);
  return flush();
}

let flushing = false;
export async function flush() {
  if (flushing) return false;
  flushing = true;
  try {
    let q = read();
    if (!q.length) return true;
    const rows = q.map(({ queued_at, ...r }) => r); // eslint-disable-line no-unused-vars
    const { error } = await supabase.from('scores').upsert(rows, { onConflict: 'round_id,subject_id,hole' });
    if (error) {
      // A permanent error (e.g. round locked) shouldn't block the queue forever.
      if (!/fetch|network/i.test(error.message)) {
        console.warn('Score save rejected', error);
        write([]);
        throw error;
      }
      return false;
    }
    // Remove only what we sent (new saves may have arrived meanwhile).
    const sent = new Set(q.map(keyOf));
    write(read().filter((r) => !sent.has(keyOf(r)) || r.queued_at > q.find((x) => keyOf(x) === keyOf(r)).queued_at));
    return true;
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flush().catch(() => {}));
  setInterval(() => {
    if (read().length) flush().catch(() => {});
  }, 15000);
}
