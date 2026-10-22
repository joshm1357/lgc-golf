// "New version ready — tap to update" (22 Oct): the banner never reloads by itself, and if a sheet is open or
// something has been typed, it asks first ("You've got something unsaved — reload anyway?"). Josh lost an open
// panel to it. Pure enough to test: it takes the document (or anything with querySelector / querySelectorAll).

export const UNSAVED_QUESTION = 'You’ve got something unsaved — reload anyway?';

const TEXTY = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password']);

/** Text boxes someone has typed in since the page loaded (React keeps a box's starting value in step with what's
 *  typed, so "changed from how it started" can't be read off the box itself). */
export const typedIn = new WeakSet();
/** Start noting typing on this page (once, from the update banner). Returns a function that stops it. */
export function watchTyping(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.addEventListener) return () => {};
  const on = (e) => { if (e?.target && typeof e.target === 'object') typedIn.add(e.target); };
  doc.addEventListener('input', on, true);
  return () => doc.removeEventListener('input', on, true);
}

/** Is there something on screen that a reload would throw away: an open sheet / dialog, or a text box with text in
 *  it (a textarea with anything typed, or an input changed from what it started as)? */
export function hasUnsavedWork(doc, typed = typedIn) {
  if (!doc?.querySelector) return false;
  try {
    if (doc.querySelector('.sheet-bg, [role="dialog"][aria-modal="true"]')) return true;
    for (const el of doc.querySelectorAll('textarea, input')) {
      if (el.disabled || el.readOnly || el.hidden) continue;
      const tag = String(el.tagName || '').toLowerCase();
      const value = String(el.value ?? '');
      if (tag === 'textarea') { if (value.trim()) return true; continue; }
      if (!TEXTY.has(String(el.type || '').toLowerCase())) continue;
      if (value.trim() && (typed.has(el) || value !== String(el.defaultValue ?? ''))) return true;
    }
  } catch { return false; }
  return false;
}

/** Tapping the banner: reload, unless there's unsaved work and the person says no. */
export function updateNow({ doc = typeof document !== 'undefined' ? document : null, ask = (q) => window.confirm(q), reload = () => window.location.reload() } = {}) {
  if (hasUnsavedWork(doc) && !ask(UNSAVED_QUESTION)) return false;
  reload();
  return true;
}
