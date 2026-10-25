// ov35: which planning chat openPlanner asked the Caddie for — a trip's id, null for a new plan, undefined for "the
// one that was open". A tiny module of its own so the Caddie button doesn't load the planning chat code.
// ov39: say / sayFor — a message to send once that trip's chat opens ("✨ Pull it together" on a trip idea).
export const chatWanted = { planId: undefined, say: null, sayFor: undefined };
export const CHAT_SWITCH = 'planchat:switch';
