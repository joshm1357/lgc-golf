import { groupFolder } from './group.js';
import { supabase } from './supabase.js';

/** Load a picked photo into something we can draw. Tries several ways — phones differ. */
async function loadImage(file) {
  // 1. Fast path.
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* try the next way */
    }
  }
  // 2. Object URL into an <img>.
  try {
    return await imgFrom(URL.createObjectURL(file));
  } catch {
    /* try the next way */
  }
  // 3. Read the bytes as a data URL.
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that photo."));
    r.readAsDataURL(file);
  });
  return imgFrom(dataUrl);
}

function imgFrom(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't open that photo."));
    img.src = src;
  });
}

/** Shrink a photo on the phone before uploading. Square-crops when `square` is true. */
export async function compressImage(file, { maxDim = 1600, quality = 0.8, square = false } = {}) {
  const img = await loadImage(file);
  const W = img.width || img.naturalWidth, H = img.height || img.naturalHeight;
  let sx = 0, sy = 0, sw = W, sh = H;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2;
    sy = (sh - s) / 2;
    sw = sh = s;
  }
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
  if (!blob) throw new Error("Couldn't shrink that photo.");
  return blob;
}

/** Upload a photo and return its public URL. Falls back to the original file if shrinking fails. */
export async function uploadPhoto(file, folder, opts) {
  let blob;
  let type = 'image/jpeg';
  try {
    blob = await compressImage(file, opts);
  } catch (e) {
    if (file.size > 12 * 1024 * 1024) throw new Error('That photo is too big to upload. Try another one.');
    blob = file;
    type = file.type || 'image/jpeg';
  }
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/heic' ? 'heic' : 'jpg';
  const path = `${groupFolder(folder)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw error;
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
