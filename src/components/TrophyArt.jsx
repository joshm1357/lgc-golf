import { useSession } from '../lib/store.jsx';
// Illustrations for the Trophy Room. Each is a self-contained SVG (viewBox 200×200).
import React from 'react';

const BRASS = '#C9A24A';
const BRASS_LT = '#EBD496';

/** The BD — silver cup on a black plinth with a brass plate, like the real one. */
export function BDCup({ size = 120, plate = 'BD', label = 'The BD trophy' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label={label} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="bd-silver" x1="0" x2="1">
          <stop offset="0" stopColor="#8E979F" /><stop offset=".35" stopColor="#F4F6F8" /><stop offset=".6" stopColor="#B9C1C8" /><stop offset="1" stopColor="#6F777E" />
        </linearGradient>
        <linearGradient id="bd-brass" x1="0" x2="1">
          <stop offset="0" stopColor="#A9822F" /><stop offset=".5" stopColor={BRASS_LT} /><stop offset="1" stopColor="#A9822F" />
        </linearGradient>
      </defs>
      <path d="M58 30 h84 v8 c0 34 -18 54 -42 58 c-24 -4 -42 -24 -42 -58 z" fill="url(#bd-silver)" stroke="#5B6168" strokeWidth="2" />
      <path d="M58 44 c-22 0 -24 30 -2 36 M142 44 c22 0 24 30 2 36" fill="none" stroke="url(#bd-silver)" strokeWidth="7" strokeLinecap="round" />
      <rect x="92" y="96" width="16" height="22" fill="url(#bd-silver)" />
      <path d="M78 118 h44 l6 14 h-56 z" fill="url(#bd-silver)" stroke="#5B6168" strokeWidth="1.5" />
      <rect x="54" y="132" width="92" height="46" rx="3" fill="#15110E" />
      <rect x="62" y="139" width="76" height="32" rx="2" fill="url(#bd-brass)" />
      <text x="100" y="162" textAnchor="middle" fontFamily="'Pirata One', serif" fontSize="24" fill="#4A3510" textLength="30" lengthAdjust="spacingAndGlyphs">{plate}</text>
      <path d="M70 40 c4 20 12 34 22 40" fill="none" stroke="#FFFFFF" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Putt Buddies — two balls arm in arm at the cup, under the flag. */
export function PuttBuddiesBadge({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="Putt Buddies trophy badge" style={{ display: 'block' }}>
      <defs>
        <path id="pb-top" d="M 34 100 A 66 66 0 0 1 166 100" />
        <path id="pb-bot" d="M 28 100 A 72 72 0 0 0 172 100" />
      </defs>
      <circle cx="100" cy="100" r="96" fill="#14472F" stroke={BRASS} strokeWidth="5" />
      <circle cx="100" cy="100" r="84" fill="none" stroke={BRASS} strokeWidth="1.5" />
      <text fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="22" fill={BRASS_LT} letterSpacing="2">
        <textPath href="#pb-top" startOffset="50%" textAnchor="middle" textLength="150" lengthAdjust="spacingAndGlyphs">PUTT BUDDIES</textPath>
      </text>
      <text fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="13" fill={BRASS_LT} letterSpacing="5">
        <textPath href="#pb-bot" startOffset="50%" textAnchor="middle" textLength="112" lengthAdjust="spacingAndGlyphs">L.G.C · AMBROSE</textPath>
      </text>
      {/* green */}
      <ellipse cx="100" cy="128" rx="54" ry="17" fill="#5FAE6E" />
      <ellipse cx="122" cy="128" rx="9" ry="3.5" fill="#0B2418" />
      {/* flag */}
      <line x1="122" y1="128" x2="122" y2="62" stroke="#F4EFE3" strokeWidth="2.5" />
      <path d="M122 63 l26 8 l-26 8 z" fill="#D8423A" />
      {/* two balls, arm in arm */}
      <circle cx="80" cy="112" r="15" fill="#FFFFFF" stroke="#C9CFD4" strokeWidth="1.5" />
      <circle cx="104" cy="114" r="13" fill="#FFFFFF" stroke="#C9CFD4" strokeWidth="1.5" />
      <g fill="#C9CFD4">
        <circle cx="74" cy="106" r="1.6" /><circle cx="80" cy="104" r="1.6" /><circle cx="86" cy="107" r="1.6" /><circle cx="76" cy="118" r="1.6" />
        <circle cx="109" cy="109" r="1.4" /><circle cx="110" cy="118" r="1.4" /><circle cx="103" cy="121" r="1.4" />
      </g>
      <path d="M90 104 q8 -10 18 -2" fill="none" stroke="#14472F" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="77" cy="110" r="1.6" fill="#14472F" /><circle cx="83" cy="110" r="1.6" fill="#14472F" />
      <path d="M76 115 q4 3 8 0" fill="none" stroke="#14472F" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="101" cy="112" r="1.4" fill="#14472F" /><circle cx="107" cy="112" r="1.4" fill="#14472F" />
      <path d="M101 117 q3 2.5 6 0" fill="none" stroke="#14472F" strokeWidth="1.4" strokeLinecap="round" />
      {/* crossed putters */}
      <g stroke={BRASS_LT} strokeWidth="3" strokeLinecap="round">
        <line x1="48" y1="70" x2="70" y2="140" />
        <line x1="152" y1="70" x2="138" y2="140" />
      </g>
      <rect x="62" y="138" width="16" height="6" rx="2" fill={BRASS_LT} />
      <rect x="130" y="138" width="16" height="6" rx="2" fill={BRASS_LT} />
    </svg>
  );
}

/** The Noodle Cup — a ramen bowl on a trophy stem, chopsticks for handles. */
export function NoodleCup({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="The Noodle Cup" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="nc-gold" x1="0" x2="1">
          <stop offset="0" stopColor="#A9822F" /><stop offset=".45" stopColor={BRASS_LT} /><stop offset="1" stopColor="#A9822F" />
        </linearGradient>
      </defs>
      <line x1="112" y1="22" x2="150" y2="78" stroke="#8A5A2B" strokeWidth="5" strokeLinecap="round" />
      <line x1="126" y1="18" x2="158" y2="72" stroke="#A86F37" strokeWidth="5" strokeLinecap="round" />
      <path d="M62 64 c6 -18 12 4 18 -12 c6 18 12 -6 18 10 c6 -16 12 6 18 -10 c6 16 12 -4 18 12" fill="none" stroke="#F2D27A" strokeWidth="4" strokeLinecap="round" />
      <path d="M66 62 c4 10 8 -6 12 6 M96 60 c4 10 8 -6 12 6 M124 62 c4 10 8 -6 12 6" fill="none" stroke="#E8C35E" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="88" cy="58" rx="9" ry="5" fill="#F7F1E3" /><circle cx="88" cy="58" r="3.5" fill="#F2B53A" />
      <path d="M44 70 h112 c0 30 -24 50 -56 50 c-32 0 -56 -20 -56 -50 z" fill="url(#nc-gold)" stroke="#7A5A1C" strokeWidth="2" />
      <path d="M56 84 h88" stroke="#7A5A1C" strokeWidth="2" strokeDasharray="6 5" />
      <rect x="92" y="120" width="16" height="16" fill="url(#nc-gold)" />
      <path d="M76 136 h48 l6 12 h-60 z" fill="url(#nc-gold)" />
      <rect x="56" y="148" width="88" height="34" rx="3" fill="#15110E" />
      <rect x="64" y="154" width="72" height="22" rx="2" fill="url(#nc-gold)" />
      <text x="100" y="170" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="13" fill="#4A3510" letterSpacing="1" textLength="62" lengthAdjust="spacingAndGlyphs">NOODLE CUP</text>
    </svg>
  );
}

export function TrophyArt({ name, type, size }) {
  const { status } = useSession();
  // L.G.C's own trophy artwork is for L.G.C only; other groups get a plain cup.
  if (status?.legacy === false) return <BDCup size={size} plate="" label={`${name || 'Trophy'}`} />;
  const n = String(name || '').toLowerCase();
  if (n.includes('noodle')) return <NoodleCup size={size} />;
  if (n.includes('putt') || type === 'ambrose') return <PuttBuddiesBadge size={size} />;
  return <BDCup size={size} />;
}
