import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { shortName, labelPriority } from '../lib/placeinfo.js';
import { WheelZoom, NamesToggle, useNamesPref, labelIcon, Declutter, PanTo, TipCard, FitTip, canHover, touchNow } from './PlanMapTools.jsx';

// The trip builder's map (077): golf course pins (tap → the course) and stay-area pins (tap → stay there / not),
// with where people come from shaded (an area, never a house). Same Esri imagery + place names as the trip finder.
// No zoom animations (the map comes and goes on a phone).
// ov22 (Josh 23 Oct): scroll-wheel zoom (after a click, or with Ctrl/⌘), a "Club names" switch (labels next to the
// course pins, overlapping ones hidden), and the pin pointed at — here or in the list beside it — grows, bounces,
// shows its name and its summary card, and the map pans to it when it's off-screen.
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
const stayIcon = (name, on, sug = false, count = null, hot = false) => L.divIcon({
  className: '',
  html: `<div class="tb-stay${on ? ' on' : ''}${hot ? ' hot' : ''}">${sug ? '✨' : '🏠'} ${String(name).replace(/[<>&"]/g, '')}${count != null ? ` · ${Number(count)}⛳` : ''}</div>`,
  iconSize: null, iconAnchor: [14, 14],
});

/**
 * courses: [{ id, name, lat, lng, on, top, sub, sug }]   on = an option / on the table; top = most voted; sug = ✨ suggested
 * stays:   [{ key, name, lat, lng, on, sug, count }]       count = courses on the table within the drive (080)
 * origin:  { lat, lng, label } | null
 * info (ov22, optional): usePlaceInfo() from the screen — hover / tap summaries, the pin pointed at, the details sheet.
 * tipFor(kind, item) → { name, lines } for the summary card ('course' | 'stay').
 */
export default function BuilderMap({ courses = [], stays = [], origin = null, onCourse, onStay, onTap, frame, className = 'tb-map', info = null, tipFor = null }) {
  const [names, setNames] = useNamesPref();
  // Frame the places to stay you can pick from, and the courses chosen for the day being built.
  const pts = frame?.length ? frame : [...stays, ...courses.filter((c) => c.on)].filter((p) => p && p.lat != null);
  const fallback = pts.length ? pts : [...stays, ...courses].filter((p) => p && p.lat != null).slice(0, 30);
  const centre = fallback[0] ? [fallback[0].lat, fallback[0].lng] : [-33.87, 151.21];
  const hot = info?.hot?.hot || null;
  const hotFrom = info?.hot?.from || null;
  const hover = canHover();
  const shownCourses = courses.filter((c) => c.lat != null).sort((a, b) => Number(a.on) - Number(b.on));
  const hotPoint = hotFrom === 'row' && hot ? (hot.startsWith('c:') ? shownCourses.find((c) => `c:${c.id}` === hot) : stays.find((s) => `s:${s.key}` === hot)) : null;
  // A click / tap: with the summary cards on, a click opens the details (a phone's first tap shows the summary).
  const clickCourse = (c) => (info ? info.tapPin(`c:${c.id}`) : onCourse?.(c));
  const clickStay = (s) => (info ? info.tapPin(`s:${s.key}`) : onStay?.(s));
  const handlers = (key, click) => ({
    click,
    ...(info && hover ? { mouseover: () => { if (!touchNow()) info.hot.hoverIn(key, 'pin'); }, mouseout: () => { if (!touchNow()) info.hot.hoverOut(); } } : {}),
  });
  const tip = (kind, item, key) => (info && tipFor && hot === key && hotFrom === 'pin' ? (
    <Tooltip key={`tip-${key}`} permanent interactive direction="top" offset={kind === 'stay' ? [0, -14] : [0, -10]} className="pm-tip">
      <TipCard tip={tipFor(kind, item)} onMore={() => info.open(key)} onEnter={info.hot.hold} onLeave={info.hot.release} />
    </Tooltip>
  ) : null);
  const labelDep = `${names}|${hot}|${shownCourses.map((c) => `${c.id}${c.on ? 1 : 0}${c.sug ? 1 : 0}`).join(',')}|${stays.map((s) => `${s.key}${s.on ? 1 : 0}${s.count ?? ''}`).join(',')}`;
  return (
    <div className={`${className} pm-wrap`} data-testid="tb-map">
      <MapContainer center={centre} zoom={9} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} wheelPxPerZoomLevel={120} zoomAnimation={false} markerZoomAnimation={false} fadeAnimation={false}>
        <TileLayer url={ESRI} maxZoom={18} attribution='Imagery © Esri · Places © Esri · Courses © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' />
        <TileLayer url={ESRI_PLACES} maxZoom={18} />
        <Frame points={fallback} />
        <WheelZoom />
        {hotPoint && <PanTo point={hotPoint} />}
        <FitTip dep={hot && hotFrom === 'pin' && info?.hot?.via === 'tap' ? hot : null} />
        {onTap && <Tap onTap={onTap} />}
        {origin?.lat != null && (
          <Circle center={[origin.lat, origin.lng]} radius={8000} pathOptions={{ color: '#1E88E5', weight: 2, fillColor: '#1E88E5', fillOpacity: 0.2 }}>
            <Tooltip direction="top">{origin.label || 'Coming from'}</Tooltip>
          </Circle>
        )}
        {shownCourses.map((c) => {
          const key = `c:${c.id}`;
          const isHot = hot === key;
          return (
            <React.Fragment key={c.id}>
              {isHot && <CircleMarker key={`ring-${c.id}`} center={[c.lat, c.lng]} radius={20} interactive={false} className="pm-ring" pathOptions={{ color: '#F2A900', weight: 3, fill: false }} />}
              <CircleMarker key={`${c.id}${isHot ? '-hot' : ''}`} center={[c.lat, c.lng]} radius={(c.on ? 10 : 7) + (isHot ? 5 : 0)}
                eventHandlers={onCourse || info ? handlers(key, () => clickCourse(c)) : undefined}
                className={isHot ? 'pm-hot' : undefined}
                pathOptions={{ color: isHot ? '#F2A900' : c.on ? '#15202E' : '#fff', weight: isHot ? 4 : c.on ? 3 : 1.5, fillColor: c.top ? PIN.voted : c.on ? PIN.option : PIN.other, fillOpacity: 0.95 }}>
                {tip('course', c, key) || (!info || !tipFor ? <Tooltip direction="top">{c.sug ? '✨ ' : ''}{c.name}{c.sub ? ` · ${c.sub}` : ''}</Tooltip> : null)}
              </CircleMarker>
              {(names || isHot) && !(isHot && hotFrom === 'pin') && (
                <Marker key={`l-${c.id}${isHot ? '-hot' : ''}`} position={[c.lat, c.lng]} interactive={false} keyboard={false} zIndexOffset={isHot ? 900 : -200}
                  icon={labelIcon(`${c.sug ? '✨ ' : ''}${shortName(c.name)}`, labelPriority(c, isHot), isHot)} />
              )}
            </React.Fragment>
          );
        })}
        {stays.filter((s) => s.lat != null).map((s) => {
          const key = `s:${s.key}`;
          const isHot = hot === key;
          return (
            <Marker key={`${s.key}${isHot ? '-hot' : ''}`} position={[s.lat, s.lng]} icon={stayIcon(s.name, s.on, s.sug, s.count, isHot)} zIndexOffset={isHot ? 1000 : 0}
              eventHandlers={onStay || info ? handlers(key, () => clickStay(s)) : undefined}>
              {tip('stay', s, key)}
            </Marker>
          );
        })}
        <Declutter dep={labelDep} />
      </MapContainer>
      <NamesToggle on={names} onChange={setNames} />
    </div>
  );
}
