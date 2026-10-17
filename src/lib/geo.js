import { useEffect, useRef, useState } from 'react';

/** Distance in metres between two {lat, lng} points. */
export function distanceM(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** One-off GPS fix. Resolves { lat, lng, accuracy } or rejects with a plain message. */
export function getFix() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone has no GPS access in the browser.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location is blocked — allow it for this site in your phone settings.' : 'Could not get a GPS fix. Try again in the open.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  });
}

/** Watch position while `on` is true. */
export function useWatchPosition(on) {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState(null);
  const id = useRef(null);
  useEffect(() => {
    if (!on || !navigator.geolocation) return undefined;
    id.current = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now() }); setError(null); },
      (e) => setError(e.code === 1 ? 'Location is blocked — allow it for this site in your phone settings.' : 'Waiting for GPS…'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id.current);
  }, [on]);
  return { pos, error };
}
