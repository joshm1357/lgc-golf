import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { initials } from './ui.jsx';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** A round avatar map pin (player photo or initials). */
export function avatarIcon(player, { gold = false, size = 36, label } = {}) {
  const inner = player?.avatar_url ? `<img src="${esc(player.avatar_url)}" alt="">` : esc(initials(player));
  const lab = label ? `<div style="margin-top:3px;background:#fff;color:#15202E;font:700 11px Barlow,sans-serif;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">${esc(label)}</div>` : '';
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);position:absolute"><div class="pin-av${gold ? ' gold' : ''}" style="width:${size}px;height:${size}px">${inner}</div>${lab}</div>`,
    iconSize: [0, 0],
  });
}

export const flagIcon = L.divIcon({
  className: '',
  html: '<div style="transform:translate(-4px,-28px);position:absolute"><svg width="26" height="30" viewBox="0 0 24 28" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M5 26V3"/><path d="M5 3h12l-3 4 3 4H5" fill="#C62828"/></svg></div>',
  iconSize: [0, 0],
});

export const teeIcon = L.divIcon({
  className: '',
  html: '<div style="transform:translate(-50%,-50%);position:absolute;background:#D9A521;color:#15202E;font:700 11px Barlow,sans-serif;padding:3px 7px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.4)">TEE</div>',
  iconSize: [0, 0],
});

function FitTo({ points, zoom }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], zoom || 17);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 18 });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * markers: [{ id, lat, lng, icon, popup, draggable, onDragEnd }]
 * fit: points to frame (defaults to all markers)
 */
export default function CourseMap({ markers = [], fit, className = 'map', zoom }) {
  const pts = (fit || markers).filter((m) => m && m.lat != null && m.lng != null);
  const center = pts[0] ? [pts[0].lat, pts[0].lng] : [-33.87, 151.21];
  return (
    <div className={className}>
      <MapContainer center={center} zoom={pts.length ? 17 : 10} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
        <TileLayer url={ESRI} maxZoom={20} maxNativeZoom={19} attribution="Imagery © Esri" />
        <FitTo points={pts} zoom={zoom} />
        {markers.filter((m) => m.lat != null).map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={m.icon} draggable={!!m.draggable}
            eventHandlers={m.onDragEnd ? { dragend: (e) => { const ll = e.target.getLatLng(); m.onDragEnd({ lat: ll.lat, lng: ll.lng }); } } : undefined}>
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
