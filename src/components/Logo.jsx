// The group's logos, drawn as SVG so they stay sharp at any size.
// Crest = the shirt logo tidied up. Icon = the BDE app icon.

const NAVY = '#1C2B3F';
const GOLD = '#D9A521';

function Club({ color, groove }) {
  return (
    <>
      <line x1="0" y1="-146" x2="0" y2="56" stroke={color} strokeWidth="8" strokeLinecap="round" />
      <line x1="0" y1="-150" x2="0" y2="-104" stroke={color} strokeWidth="15" strokeLinecap="round" />
      <path d="M-7 50 L-7 82 Q-7 92 4 92 L44 92 Q54 92 52 80 L48 58 Q46 48 36 48 L2 48 Z" fill={color} />
      <path d="M8 60h32M8 68h35M8 76h37M8 84h38" stroke={groove} strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

export function Crest({ size = 48, title = 'L.G.C Big Dick Energy crest' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" role="img" aria-label={title} style={{ display: 'block', flex: 'none' }}>
      <circle cx="200" cy="200" r="186" fill="#FFFFFF" stroke={NAVY} strokeWidth="12" />
      <circle cx="200" cy="200" r="170" fill="none" stroke={NAVY} strokeWidth="2" />
      <g transform="translate(200 200) rotate(-38)"><Club color={NAVY} groove="#FFFFFF" /></g>
      <g transform="translate(200 200) scale(-1 1) rotate(-38)"><Club color={NAVY} groove="#FFFFFF" /></g>
      <polygon points="40,164 76,164 76,206 40,206 52,185" fill="#2E4561" />
      <polygon points="360,164 324,164 324,206 360,206 348,185" fill="#2E4561" />
      <polygon points="62,196 76,196 76,206" fill="#0F1A28" />
      <polygon points="338,196 324,196 324,206" fill="#0F1A28" />
      <rect x="62" y="150" width="276" height="46" fill={NAVY} />
      <text x="200" y="183" textAnchor="middle" fontFamily="'Pirata One', serif" fontSize="31" fill="#F4EFE3" letterSpacing="1">Big Dick Energy</text>
      <text x="200" y="128" textAnchor="middle" fontFamily="'Pirata One', serif" fontSize="40" fill={NAVY} letterSpacing="4">L.G.C</text>
      <path d="M178 322 L222 322 L214 331 L205 331 L200 364 L195 331 L186 331 Z" fill={NAVY} />
      <path d="M219 276 h8 a8 8 0 0 1 8 8 v14 a8 8 0 0 1 -8 8 h-8" fill="none" stroke={NAVY} strokeWidth="5" />
      <rect x="181" y="264" width="38" height="56" rx="3" fill="#E3A82B" stroke={NAVY} strokeWidth="5" />
      <path d="M192 282 v26 M200 286 v26 M208 282 v26" stroke="#FFF4D6" strokeWidth="2" strokeLinecap="round" />
      <path d="M177 270 q-2 -13 11 -12 q4 -10 14 -6 q10 -7 16 3 q9 0 7 15 z" fill="#FFFFFF" stroke={NAVY} strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

export function IconBDE({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" role="img" aria-label="BDE" style={{ display: 'block', flex: 'none' }}>
      <rect x="8" y="8" width="384" height="384" rx="88" fill={NAVY} />
      <g transform="translate(200 222) rotate(-38)"><Club color={GOLD} groove={NAVY} /></g>
      <g transform="translate(200 222) scale(-1 1) rotate(-38)"><Club color={GOLD} groove={NAVY} /></g>
      <text x="200" y="98" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontSize="30" fontWeight="700" fill="#F4EFE3" letterSpacing="8">L.G.C</text>
      <text x="200" y="226" textAnchor="middle" fontFamily="'Pirata One', serif" fontSize="112" fill="#F4EFE3" stroke={NAVY} strokeWidth="14" strokeLinejoin="round" paintOrder="stroke">BDE</text>
    </svg>
  );
}
