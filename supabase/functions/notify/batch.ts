// Combined vote cards (077 vote_batches): several polls shown as ONE card, sent as ONE notification, and reminded
// once — only to people who haven't answered every section (and, if the card asks "Are you keen?", said In / Maybe /
// Out). Pure functions, tested in batch.test.ts. Same rule as src/lib/tripbuilder.js batchNonVoters.

export type Vote = { poll_id: string; player_id: string };

/** Who still hasn't answered: no vote in at least one section, or (keen cards) no In / Maybe / Out. */
export function batchNonVoters(o: { pollIds: string[]; votes: Vote[]; rsvps: { player_id: string }[]; keen: boolean; playerIds: string[] }): string[] {
  return o.playerIds.filter((pid) => {
    const mine = new Set(o.votes.filter((v) => v.player_id === pid).map((v) => v.poll_id));
    if (o.pollIds.some((id) => !mine.has(id))) return true;
    return o.keen && !o.rsvps.some((r) => r.player_id === pid);
  });
}

/** Polls closing tomorrow → one reminder per card (batch) and one per poll that isn't on a card. */
export function reminderGroups<T extends { id: string; vote_batch?: string | null }>(polls: T[]): { batch: string | null; polls: T[] }[] {
  const out: { batch: string | null; polls: T[] }[] = [];
  const by = new Map<string, T[]>();
  for (const p of polls) {
    if (!p.vote_batch) { out.push({ batch: null, polls: [p] }); continue; }
    if (!by.has(p.vote_batch)) by.set(p.vote_batch, []);
    by.get(p.vote_batch)!.push(p);
  }
  for (const [batch, ps] of by) out.push({ batch, polls: ps });
  return out;
}

/** The one notification for a card: "🗳️ Vote: Where and when?" · "Spring trip · 3 questions · closes Fri 14 Nov". */
export function batchMessage(o: { title: string; planName: string; sections: number; keen: boolean; closes?: string | null }) {
  const n = o.sections + (o.keen ? 1 : 0);
  return {
    title: `🗳️ Vote: ${o.title}`.slice(0, 100),
    body: [o.planName, `${n} quick question${n === 1 ? '' : 's'}`, o.closes ? `closes ${o.closes}` : null].filter(Boolean).join(' · ').slice(0, 200),
  };
}
