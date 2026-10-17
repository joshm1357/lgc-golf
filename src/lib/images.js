import { supabase } from './supabase.js';

/** Shrink a photo on the phone before uploading. Square-crops when `square` is true. */
export async function compressImage(file, { maxDim = 1600, quality = 0.8, square = false } = {}) {
  const bitmap = await loadBitmap(file);
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;
  if (square) {
    const s = Math.min(sw, sh);
    sx = (sw - s) / 2;
    sy = (sh - s) / 2;
    sw = sh = s;
  }
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Upload a photo and return its public URL. */
export async function uploadPhoto(file, folder, opts) {
  const blob = await compressImage(file, opts);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
