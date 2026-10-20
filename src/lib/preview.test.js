import { describe, it, expect } from 'vitest';
import { blockedWhileViewing, viewAsStatus, previewOf, startPreview, stopPreview } from './preview.js';

const V = { player_id: 'p-mike', name: 'Mike', group_id: 'g1' };
const BASE = 'https://x.supabase.co';

describe('blockedWhileViewing', () => {
  it('lets everything through when not viewing', () => {
    expect(blockedWhileViewing(`${BASE}/rest/v1/scores`, 'POST', null)).toBe(false);
  });
  it('allows reads', () => {
    expect(blockedWhileViewing(`${BASE}/rest/v1/scores?select=*`, 'GET', V)).toBe(false);
    expect(blockedWhileViewing(`${BASE}/rest/v1/rpc/my_status`, 'POST', V)).toBe(false);
    expect(blockedWhileViewing(`${BASE}/rest/v1/rpc/course_page`, 'POST', V)).toBe(false);
    expect(blockedWhileViewing(`${BASE}/storage/v1/object/public/photos/a.jpg`, 'GET', V)).toBe(false);
  });
  it('stops every change', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(blockedWhileViewing(`${BASE}/rest/v1/scores`, m, V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/rest/v1/rpc/cast_vote`, 'POST', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/rest/v1/rpc/send_feedback`, 'POST', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/storage/v1/object/photos/a.jpg`, 'POST', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/functions/v1/notify`, 'POST', V)).toBe(true);
  });
  it('keeps the organiser signed in, but no other sign-in change', () => {
    expect(blockedWhileViewing(`${BASE}/auth/v1/token?grant_type=refresh_token`, 'POST', V)).toBe(false);
    expect(blockedWhileViewing(`${BASE}/auth/v1/logout`, 'POST', V)).toBe(false);
    expect(blockedWhileViewing(`${BASE}/auth/v1/user`, 'GET', V)).toBe(false);
    expect(blockedWhileViewing(`${BASE}/auth/v1/user`, 'PUT', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/auth/v1/otp`, 'POST', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/auth/v1/token?grant_type=password`, 'POST', V)).toBe(true);
  });
  it("refuses anything else that isn't a read", () => {
    expect(blockedWhileViewing(`${BASE}/realtime/v1/api/broadcast`, 'POST', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/graphql/v1`, 'POST', V)).toBe(true);
    expect(blockedWhileViewing(`${BASE}/rest/v1/rpc/invite_info`, 'POST', V)).toBe(true);
  });
});

describe('viewAsStatus', () => {
  const org = { is_member: true, is_admin: true, role: 'organiser', player_id: 'p-josh', group_id: 'g1' };
  it('becomes the player, with a player’s rights', () => {
    const s = viewAsStatus(org, V);
    expect(s).toMatchObject({ player_id: 'p-mike', is_admin: false, role: 'player', viewing: { name: 'Mike', organiser_player_id: 'p-josh' } });
  });
  it('only for an organiser of that same group', () => {
    expect(viewAsStatus({ ...org, is_admin: false, role: 'player' }, V).player_id).toBe('p-josh');
    expect(viewAsStatus({ ...org, group_id: 'g2' }, V).player_id).toBe('p-josh');
    expect(viewAsStatus(org, null)).toBe(org);
  });
});

describe('previewOf / startPreview / stopPreview', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  it('remembers and forgets', () => {
    const s = mem();
    expect(previewOf(s)).toBe(null);
    startPreview(V, s);
    expect(previewOf(s)).toEqual(V);
    stopPreview(s);
    expect(previewOf(s)).toBe(null);
  });
  it('ignores rubbish', () => {
    const s = mem();
    s.setItem('tgt-preview', '{"player_id":1}');
    expect(previewOf(s)).toBe(null);
    s.setItem('tgt-preview', 'not json');
    expect(previewOf(s)).toBe(null);
  });
});
