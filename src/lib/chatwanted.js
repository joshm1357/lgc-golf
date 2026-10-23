// ov35: which planning chat openPlanner asked the Caddie for — a trip's id, null for a new plan, undefined for "the
// one that was open". A tiny module of its own so the Caddie button doesn't load the planning chat code.
export const chatWanted = { planId: undefined };
export const CHAT_SWITCH = 'planchat:switch';
