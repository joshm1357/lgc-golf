// The outbox: feed posts and side comp entries made with no signal wait on the phone and send
// themselves when signal returns — like scores do (offline.js), but for anything with a photo.
//
// Plain words:
//   - Each item gets its id on the phone, so sending it twice can never make two copies.
//   - With signal, it just sends (photo included). Only if that fails does it wait on the phone;
//     the photo then waits in the phone's database (IndexedDB) because it's too big for normal storage.
//   - Once a photo has uploaded, its link is saved straight away, so a retry never uploads it twice.
//   - No signal is never a reason to give up: items wait up to 7 days. A real refusal (e.g. the round
//     has been locked, the photo can't be read) drops that one item and says so; the rest carry on.
import { supabase } from './supabase.js';
import { uploadPhoto } from './images.js';

const KEY = 'lgc-outbox';
const MAX_AGE = 7 * 24 * 3600 * 1000;
const listeners = new Set();
const dropListeners = new Set();
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
const update = (id, patch) => write(read().map((x) => (x.id === id ? { ...x, ...patch } : x)));
const remove = (id) => write(read().filter((x) => x.id !== id));
export const outboxCount = () => read().length;
export function onOutboxChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Called with a plain message when an item had to be dropped. */
export function onOutboxDrop(fn) { dropListeners.add(fn); return () => dropListeners.delete(fn); }
const dropped = (msg) => dropListeners.forEach((fn) => fn(msg));

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

/** A refusal that won't change by trying again: a database rule, or a photo the phone can't read/send. */
function isPermanent(e) {
  if (/^(42|23|22)/.test(e?.code || '')) return true;
  if (e?.localPhoto) return true;
  const st = Number(e?.statusCode || e?.status || 0);
  return st >= 400 && st < 500 && st !== 408 && st !== 429;
}
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
async function upload(file, folder) {
  try {
    return await withTimeout(uploadPhoto(file, folder), 45000);
  } catch (e) {
    if (/too big|couldn.t read/i.test(e?.message || '')) e.localPhoto = true;
    throw e;
  }
}
async function insert(table, row) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true }).abortSignal(ctl.signal);
    if (error) throw error;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Send now if there's signal, otherwise keep it and send later.
 * opts.photo = { file, field: 'photo_url', folder: 'feed' }
 * Returns { sent: true, row } or { sent: false } (queued). Throws only for a real refusal.
 */
export async function sendOrQueue(table, row, opts = {}) {
  const id = row.id || uuid();
  const item = { id, table, row: { ...row, id }, queued_at: new Date().toISOString() };
  const photo = opts.photo?.file ? { field: opts.photo.field || 'photo_url', folder: opts.photo.folder || 'feed' } : null;
  try {
    if (photo) item.row[photo.field] = await upload(opts.photo.file, photo.folder);
    await insert(table, item.row);
    return { sent: true, row: item.row };
  } catch (e) {
    if (isPermanent(e)) throw e;
    // No signal: keep it. The photo waits in IndexedDB unless it already uploaded.
    if (photo && !item.row[photo.field]) {
      try {
        await photoOp('put', id, opts.photo.file);
        item.photo = photo;
      } catch {
        throw Object.assign(new Error('No signal, and this phone can’t hold the photo for later — try again when you have signal.'), { localPhoto: true });
      }
    }
    write([...read(), item]);
    return { sent: false };
  }
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || !read().length) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  flushing = true;
  try {
    for (const item of [...read()]) {
      if (Date.now() - new Date(item.queued_at).getTime() > MAX_AGE) {
        remove(item.id);
        if (item.photo) photoOp('delete', item.id).catch(() => {});
        dropped('A post from over a week ago never found signal and was dropped.');
        continue;
      }
      try {
        if (item.photo && !item.row[item.photo.field]) {
          const blob = await photoOp('get', item.id).catch(() => null);
          if (blob) {
            const url = await upload(blob, item.photo.folder);
            item.row = { ...item.row, [item.photo.field]: url };
            update(item.id, { row: item.row }); // saved before the insert, so a retry never re-uploads
          }
        }
        await insert(item.table, item.row);
        remove(item.id);
        if (item.photo) photoOp('delete', item.id).catch(() => {});
      } catch (e) {
        if (isPermanent(e)) {
          remove(item.id);
          if (item.photo) photoOp('delete', item.id).catch(() => {});
          dropped(`A saved ${item.table === 'posts' ? 'post' : 'comp entry'} was refused: ${e.message || 'not allowed'}`);
          continue; // the next one may still go
        }
        break; // no signal — everything else would fail too; try again later
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
