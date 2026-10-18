// Phone notifications (Web Push) + sharing helpers.
//
// Plain words:
//   - Android: works in Chrome straight away.
//   - iPhone: only works once the app is on the Home Screen (Share → Add to Home Screen)
//     and opened from there, on iOS 16.4 or newer. Apple's rule, not ours.
//   - The app tells the 'notify' server function what happened; the server writes
//     the message and sends it, so nobody can send made-up notifications.
import { currentGroup } from './group.js';
import { supabase } from './supabase.js';

export const VAPID_PUBLIC = 'BCfEi9CqrSZi7EMNXBjBvwjPYsy-EPe4uM9BCqx7showM-O8MUOQBPQeCtnBDZDwKWDlUQpU-JVR2aqR6tz-H9I';
const SW_URL = `${import.meta.env.BASE_URL}sw.js`;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** 'unsupported' | 'needs-home-screen' | 'blocked' | 'off' | 'on' */
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Must be called from a tap (browsers only ask permission in response to a tap). */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked — allow them for this app in your phone settings.' : 'Notifications weren’t allowed.');
  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
  const j = sub.toJSON();
  // Saves this phone under me — and takes it over if an old sign-in on this phone had it.
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent });
  if (error) throw error;
  await notify('test');
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

/** Tell the server something happened. Never throws — a failed notification shouldn't block the action. */
export async function notify(type, payload = {}) {
  try {
    const { data, error } = await supabase.functions.invoke('notify', { body: { type, group_id: currentGroup() || undefined, ...payload } });
    if (error) return { sent: 0, error };
    return data || { sent: 0 };
  } catch (error) {
    return { sent: 0, error };
  }
}

/** Share sheet (pick Messenger) where available; otherwise copy to the clipboard. Returns 'shared' | 'copied' | 'failed'. */
export async function shareText(text, title = 'The Golf Trip') {
  try {
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Save a calendar file — opens in the phone's calendar. iPhone Home Screen apps need the share sheet. */
export async function downloadFile(name, text, type = 'text/calendar') {
  try {
    const file = new File([text], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const appLink = (path = '') => `${window.location.origin}${import.meta.env.BASE_URL}#${path}`;
