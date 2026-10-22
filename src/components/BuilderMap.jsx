import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// The trip builder's map (077): golf course pins (tap → the course) and stay-area pins (tap → stay there / not),
// with where people come from shaded (an area, never a house). Same Esri imagery + place names as the trip finder.
// No animations (the map comes and goes on a phone).
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_PLACES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
export const PIN = { option: '#0E9F8E', other: '#F2A900', voted: '#C8102E' };

function Tap({ onTap }) {
  useMapEvents({ click: (e) => onTap({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}
function Frame({ points }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 10);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [24, 24], maxZoom: 11 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
const stayIcon = (name, on) => L.divIcon({
  className: '',
  html: `<div class="tb-stay${on ? ' on' : ''}">🏠 ${String(name).replace(/[<>&"]/g, '')}</div>`,
  iconSize: null, iconAnchor: [14, 14],
});

/**
 * courses: [{ id, name, lat, lng, on, top, sub }]   on = an option for the day being built; top = most voted
 * stays:   [{ key, name, lat, lng, on }]
 * origin:  { lat, lng, label } | null
 */
export default function BuilderMap({ courses = [], stays = [], origin = null, onCourse, onStay, onTap, frame, className = 'tb-map' }) {
  const pts = frame?.length ? frame : [...stays.filter((s) => s.on), ...courses.filter((c) => c.on)].filter((p) => p && p.lat != null);
  const fallback = pts.length ? pts : [...stays, ...courses].filter((p) => p && p.lat != null).slice(0, 30);
  const centre = fallback[0] ? [fallback[0].lat, fallback[0].lng] : [-33.87, 151.21];
  return (
    <div className={className} data-testid="tb-map">
      <MapContainer center={centre} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} zoomAnimation={false} markerZoomAnimation={false} fadeAnimation={false}>
        <TileLayer url={ESRI} maxZoom={18} attribution='Imagery © Esri · Places © Esri · Courses © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' />
        <TileLayer url={ESRI_PLACES} maxZoom={18} />
        <Frame points={fallback} />
        {onTap && <Tap onTap={onTap} />}
        {origin?.lat != null && (
          <Circle center={[origin.lat, origin.lng]} radius={8000} pathOptions={{ color: '#1E88E5', weight: 2, fillColor: '#1E88E5', fillOpacity: 0.2 }}>
            <Tooltip direction="top">{origin.label || 'Coming from'}</Tooltip>
          </Circle>
        )}
        {courses.filter((c) => c.lat != null).sort((a, b) => Number(a.on) - Number(b.on)).map((c) => (
          <CircleMarker key={c.id} center={[c.lat, c.lng]} radius={c.on ? 10 : 7}
            eventHandlers={onCourse ? { click: () => onCourse(c) } : undefined}
            pathOptions={{ color: c.on ? '#15202E' : '#fff', weight: c.on ? 3 : 1.5, fillColor: c.top ? PIN.voted : c.on ? PIN.option : PIN.other, fillOpacity: 0.95 }}>
            <Tooltip direction="top">{c.name}{c.sub ? ` · ${c.sub}` : ''}</Tooltip>
          </CircleMarker>
        ))}
        {stays.filter((s) => s.lat != null).map((s) => (
          <Marker key={s.key} position={[s.lat, s.lng]} icon={stayIcon(s.name, s.on)} eventHandlers={onStay ? { click: () => onStay(s) } : undefined} />
        ))}
      </MapContainer>
    </div>
  );
}
