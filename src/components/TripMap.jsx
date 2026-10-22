import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// The trip finder's map (Stage 16.5): starting AREAS shaded (never pins on houses), and courses coloured by fit —
// teal fits, amber check (facts unknown), grey doesn't fit. Esri imagery like the other maps, plus Esri's free place
// names on top so towns can be read at this zoom. No keys, nothing paid. No animations: on a phone the map comes and
// goes (List / Map), and Leaflet's zoom animation fails if its map is taken away mid-zoom.

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_PLACES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
export const FIT_COLOUR = { fits: '#0E9F8E', check: '#F2A900', no: '#9AA3AD' };
export const FIT_WORD = { fits: 'Fits', check: 'Check', no: 'Doesn’t fit' };

function Tap({ onTap }) {
  useMapEvents({ click: (e) => onTap({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function Frame({ points }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 9);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [30, 30], maxZoom: 11 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * starts:  [{ label, lat, lng, count }]
 * results: assessed courses (lib/tripfinder.js) — [{ course, status, why }], best first
 * picked:  Set of course ids ticked
 * onTap:   tap the map to place a starting area (optional)
 * onOpen:  open a course's details
 */
export default function TripMap({ starts = [], results = [], picked = new Set(), onTap, onOpen, className = 'map tf-map', frame }) {
  const pts = frame || [...starts, ...results.filter((r) => r.status !== 'no').slice(0, 15).map((r) => r.course)].filter((p) => p && p.lat != null);
  const centre = pts[0] ? [pts[0].lat, pts[0].lng] : [-33.87, 151.21];
  return (
    <div className={className} data-testid="tf-map">
      <MapContainer center={centre} zoom={8} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} zoomAnimation={false} markerZoomAnimation={false} fadeAnimation={false}>
        <TileLayer url={ESRI} maxZoom={18} attribution='Imagery © Esri · Places © Esri · Courses © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' />
        <TileLayer url={ESRI_PLACES} maxZoom={18} />
        <Frame points={pts} />
        {onTap && <Tap onTap={onTap} />}
        {starts.filter((s) => s.lat != null).map((s, i) => (
          <Circle key={`s${i}`} center={[s.lat, s.lng]} radius={6000} pathOptions={{ color: '#1E88E5', weight: 2, fillColor: '#1E88E5', fillOpacity: 0.25 }}>
            <Tooltip permanent direction="top" offset={[0, -8]}>{s.label} ×{s.count}</Tooltip>
          </Circle>
        ))}
        {[...results].reverse().map((r) => {
          const rank = results.indexOf(r) + 1;
          const on = picked.has(r.course.id);
          return (
            <CircleMarker key={r.course.id} center={[r.course.lat, r.course.lng]} radius={r.status === 'no' ? 5 : on ? 11 : 8}
              pathOptions={{ color: on ? '#15202E' : '#fff', weight: on ? 3 : 1.5, fillColor: FIT_COLOUR[r.status], fillOpacity: 0.95 }}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <strong>{rank}. {r.course.name}</strong>
                  <div style={{ fontSize: 12, margin: '4px 0' }}>{r.why}</div>
                  {onOpen && <button type="button" className="btn sm" onClick={() => onOpen(r)}>Details</button>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
