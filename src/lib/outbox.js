// The outbox: feed posts and side comp entries made with no signal wait on the phone and send
// themselves when signal returns — like scores do (offline.js), but for anything with a photo.
//
// Plain words:
//   - Each item gets its id on the phone, so sending it twice can never make two copies.
//   - Photos wait in the phone's database (IndexedDB) because they're too big for normal storage.
//   - A permanent refusal (e.g. the round has been locked) drops the item and says so.
import { supabase } from './supabase.js';
import { uploadPhoto } from './images.js';

const KEY = 'lgc-outbox';
const listeners = new Set();
let mem = null;

function read() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { mem = []; }
  return mem;
}
function write(q) {
  mem = q;
  try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* kept in memory */ }
  listeners.forEach((fn) => fn(q.length));
}
export const outboxCount = () => read().length;
export function onOutboxChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// ---- photos waiting to upload (IndexedDB, tiny helper) ----
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lgc', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function photoOp(mode, key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode === 'get' ? 'readonly' : 'readwrite');
    const st = tx.objectStore('photos');
    const r = mode === 'put' ? st.put(value, key) : mode === 'get' ? st.get(key) : st.delete(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
}));
const isPermanent = (error) => /^(42|23|22)/.test(error?.code || '');

async function sendOne(item) {
  const row = { ...item.row };
  if (item.photo) {
    const blob = await photoOp('get', item.id);
    if (blob) row[item.photo.field] = await uploadPhoto(blob, item.photo.folder);
  }
  const { error } = await supabase.from(item.table).upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
  if (item.photo) await photoOp('delete', item.id).catch(() => {});
  return row;
}

/**
 * Send now if there's signal, otherwise keep it and send later.
 * opts.photo = { file, field: 'photo_url', folder: 'feed' }
 * Returns { sent: true, row } or { sent: false } (queued). Throws only for a permanent refusal.
 */
export async function sendOrQueue(table, row, opts = {}) {
  const item = { id: row.id || uuid(), table, row: { ...row }, queued_at: new Date().toISOString() };
  item.row.id = item.id;
  if (opts.photo?.file) {
    item.photo = { field: opts.photo.field || 'photo_url', folder: opts.photo.folder || 'feed' };
    try { await photoOp('put', item.id, opts.photo.file); } catch { item.photo = null; }
  }
  try {
    const sent = await sendOne(item);
    return { sent: true, row: sent };
  } catch (e) {
    if (isPermanent(e)) { if (item.photo) photoOp('delete', item.id).catch(() => {}); throw e; }
    write([...read(), item]);
    return { sent: false };
  }
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || !read().length) return;
  flushing = true;
  try {
    for (const item of [...read()]) {
      try {
        await sendOne(item);
        write(read().filter((x) => x.id !== item.id));
      } catch (e) {
        if (isPermanent(e)) {
          write(read().filter((x) => x.id !== item.id));
          if (item.photo) photoOp('delete', item.id).catch(() => {});
        } else {
          // Still no signal (or a hiccup) — try again later; give up on an item after ~40 tries.
          item.tries = (item.tries || 0) + 1;
          if (item.tries > 40) write(read().filter((x) => x.id !== item.id));
          else write([...read()]);
          break;
        }
      }
    }
  } finally {
    flushing = false;
  }
}

let started = false;
export function startOutbox() {
  if (started) return;
  started = true;
  window.addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flushOutbox());
  setInterval(flushOutbox, 30000);
  flushOutbox();
}
