// ov29 (23 Oct 2026) — side games put out for an opt-in (migration 098): "Bo's put up $5 skins for Saturday. You in?"
// One notification per game (the notify function's 'game_proposed' kind), and at most 3 a day from one person, so a
// keen proposer can't flood the group. The Feed post is made by the database itself (098), once per game.
// This file only loads the rows for ONE group and writes the words; index.ts does the sending.
// deno-lint-ignore-file no-explicit-any
type Db = any;

const SHORT: Record<string, string> = { skins: 'skins', nassau: 'Nassau', stableford_pot: 'Stableford pot', birdie_pool: 'birdie pool', eclectic: 'eclectic' };
const first = (p?: { name?: string; nickname?: string } | null) => String(p?.nickname || p?.name || 'Someone').trim().split(/\s+/)[0];

/** "$5" / "$2.50". */
export function money(stake: unknown) {
  const c = Math.round(Number(stake || 0) * 100);
  return `$${Math.floor(c / 100)}${c % 100 ? `.${String(c % 100).padStart(2, '0')}` : ''}`;
}

/** "Saturday" from "2099-01-03", or '' with no date. */
export function dayName(playDate?: string | null) {
  const d = String(playDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
}

/** The words: same as the app (games.js proposeWords) and the Feed post (098). */
export function gameProposedMessage({ who, game, round, customName = null }:
  { who?: { name?: string; nickname?: string } | null; game: { kind: string; stake: unknown }; round: { name?: string; play_date?: string | null }; customName?: string | null }) {
  const what = `${money(game.stake)} ${customName || SHORT[game.kind] || 'side game'}`;
  const day = dayName(round.play_date) || round.name || 'the round';
  return { title: `🎲 ${first(who)}’s put up ${what} for ${day}`, body: 'You in? Tap to say In or Out — opt-in closes at the first tee.' };
}

/** Can `from` (a player, or an organiser) send the buzz for this game? Returns a reason when not, else null. */
export function proposeProblem(game: any, from: string | null, isOrganiser: boolean) {
  if (!game) return 'Not in your group';
  if (game.who_in !== 'opt_in') return 'Only an opt-in game is put out to the group';
  if (game.retired) return 'That side game has been taken down';
  if (!isOrganiser && (!from || game.created_by !== from)) return 'Not your side game';
  return null;
}

/** The game, its round, its custom name and the proposer — all of group `g` — or null when it isn't this group's. */
export async function proposedBits(db: Db, g: string, gameId: string) {
  if (!gameId) return null;
  const { data: game } = await db.from('round_games').select('*').eq('id', gameId).eq('group_id', g).maybeSingle();
  if (!game) return null;
  const [{ data: round }, { data: custom }, { data: who }] = await Promise.all([
    db.from('rounds').select('id,name,play_date,status,trip_id').eq('id', game.round_id).eq('group_id', g).maybeSingle(),
    game.custom_game_id ? db.from('custom_games').select('name').eq('id', game.custom_game_id).eq('group_id', g).maybeSingle() : Promise.resolve({ data: null }),
    game.created_by ? db.from('players').select('name,nickname').eq('id', game.created_by).eq('group_id', g).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!round) return null;
  return { game, round, customName: custom?.name || null, who };
}
