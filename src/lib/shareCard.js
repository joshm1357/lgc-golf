// Stage 9: share cards — a winner, a final leaderboard or a Tribunal verdict as a picture for the group chat, with a
// small "Made with The Golf Trip". Drawn on the phone (no outside service, nothing to install).

const W = 1080;
const H = 1350;

/** What goes on the card, as plain data (tested without a browser). */
export function cardContent(kind, d = {}) {
  if (kind === 'leaderboard') {
    const rows = (d.rows || []).slice(0, 8).map((r, i) => ({
      pos: r.thru ? String(i + 1) : '–',
      name: String(r.name || '').slice(0, 26),
      score: r.score == null ? '–' : String(r.score),
      first: i === 0,
    }));
    return { eyebrow: d.final ? 'FINAL LEADERBOARD' : 'LEADERBOARD', title: d.roundName || 'The round', sub: [d.courseName, d.date].filter(Boolean).join(' · '), rows, scoreLabel: d.scoreLabel || 'PTS' };
  }
  if (kind === 'winner') {
    return { eyebrow: '🏆 WINNER', big: String(d.name || '').slice(0, 30), line: d.score ? String(d.score) : '', title: d.roundName || '', sub: [d.courseName, d.date].filter(Boolean).join(' · ') };
  }
  if (kind === 'verdict') {
    const guilty = d.verdict === 'upheld';
    return {
      eyebrow: 'THE HANDICAP TRIBUNAL',
      big: guilty ? 'GUILTY' : 'NOT GUILTY',
      title: String(d.accused || '').slice(0, 30),
      line: guilty && d.oldHcp != null && d.newHcp != null ? `Handicap ${d.oldHcp} → ${d.newHcp}` : 'Handicap stays as it is',
      sub: d.votes ? `Vote ${d.votes}${d.overruled ? ' · chair overruled' : ''}` : '',
    };
  }
  return { eyebrow: '', title: '' };
}

function fitText(ctx, text, max, size, weight = 700, family = 'Barlow, system-ui, sans-serif') {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 20 && ctx.measureText(text).width > max) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

/** Draw the card and return it as a PNG file. */
export async function drawCard(kind, data, look = {}) {
  const c = cardContent(kind, data);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  try { await document.fonts?.ready; } catch { /* system font is fine */ }
  const bg = look.primary || '#0E1F17';
  const gold = look.accent || '#E0B84A';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, H - 150, W, 150);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = gold; ctx.font = '700 38px Barlow, system-ui, sans-serif';
  ctx.fillText(c.eyebrow, 80, 150);
  if (kind === 'leaderboard') {
    ctx.fillStyle = '#fff'; fitText(ctx, c.title, W - 160, 76); ctx.fillText(c.title, 80, 245);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '500 36px Barlow, system-ui, sans-serif'; ctx.fillText(c.sub, 80, 300);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '700 28px Barlow, system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.fillText(c.scoreLabel, W - 80, 385); ctx.textAlign = 'left';
    c.rows.forEach((r, i) => {
      const y = 460 + i * 92;
      if (r.first) { ctx.fillStyle = 'rgba(224,184,74,0.18)'; ctx.fillRect(56, y - 62, W - 112, 84); }
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '600 44px Barlow, system-ui, sans-serif'; ctx.fillText(r.pos, 80, y);
      ctx.fillStyle = '#fff'; fitText(ctx, r.name, W - 400, 50); ctx.fillText(r.name, 170, y);
      ctx.fillStyle = gold; ctx.font = '800 54px Barlow, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(r.score, W - 80, y); ctx.textAlign = 'left';
    });
  } else {
    ctx.textAlign = 'center';
    ctx.fillStyle = kind === 'verdict' && c.big === 'GUILTY' ? '#FF8A80' : gold;
    fitText(ctx, c.big, W - 160, 150, 800); ctx.fillText(c.big, W / 2, 560);
    ctx.fillStyle = '#fff'; fitText(ctx, c.title, W - 160, 72); ctx.fillText(c.title, W / 2, kind === 'verdict' ? 400 : 690);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '600 48px Barlow, system-ui, sans-serif'; ctx.fillText(c.line, W / 2, kind === 'verdict' ? 700 : 790);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; fitText(ctx, c.sub, W - 160, 36, 500); ctx.fillText(c.sub, W / 2, kind === 'verdict' ? 790 : 880);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '600 32px Barlow, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText('Made with The Golf Trip ⛳', W / 2, H - 62); ctx.textAlign = 'left';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Couldn’t make the picture on this phone.');
  return new File([blob], `${kind}.png`, { type: 'image/png' });
}

/** Share the picture (the phone's share sheet), with a line of text and a link; or save it if sharing pictures isn't
 * possible on this phone. Returns 'shared' | 'saved' | 'cancelled'. */
export async function sharePicture(file, text) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}

/** A round's board as card data (top 8). */
export function boardCard(board, { roundName, courseName, playDate, final } = {}) {
  const isA = board?.format === 'ambrose' || board?.format === 'stroke'; // net to par
  const fmt = (n) => (n > 0 ? `+${n}` : n === 0 ? 'E' : String(n));
  const date = playDate ? new Date(`${playDate}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return {
    roundName, courseName, date, final,
    scoreLabel: isA ? 'NET' : 'PTS',
    rows: (board?.rows || []).map((r) => ({ name: r.name, thru: r.thru, score: !r.thru ? null : isA ? fmt(r.netToPar) : r.points })),
  };
}
