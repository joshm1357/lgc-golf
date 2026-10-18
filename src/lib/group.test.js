import { describe, it, expect } from 'vitest';
import { scopeRequest, groupFolder, GROUP_TABLES } from './group.js';

const G = '11111111-2222-4333-8444-555555555555';
const BASE = 'https://x.supabase.co/rest/v1';

describe('scopeRequest — every read of a group table is limited to the current group', () => {
  it('adds the group filter to a plain read of a group table', () => {
    const r = scopeRequest(`${BASE}/players?select=*`, 'GET', G);
    expect(new URL(r.url).searchParams.get('group_id')).toBe(`eq.${G}`);
    expect(r.header).toBe(G);
  });
  it('keeps an existing group filter', () => {
    const r = scopeRequest(`${BASE}/posts?select=*&group_id=eq.abc`, 'GET', G);
    expect(new URL(r.url).searchParams.getAll('group_id')).toEqual(['eq.abc']);
  });
  it('never filters rooms & cars (their group_id is the room, not the golf group)', () => {
    const r = scopeRequest(`${BASE}/plan_group_members?select=*&group_id=in.(a,b)`, 'GET', G);
    expect(new URL(r.url).searchParams.getAll('group_id')).toEqual(['in.(a,b)']);
    expect(GROUP_TABLES.has('plan_group_members')).toBe(false);
  });
  it('does not touch writes, function calls or other tables, but still sends the header', () => {
    expect(new URL(scopeRequest(`${BASE}/scores`, 'POST', G).url).searchParams.has('group_id')).toBe(false);
    expect(new URL(scopeRequest(`${BASE}/rpc/my_status`, 'POST', G).url).searchParams.has('group_id')).toBe(false);
    expect(scopeRequest(`${BASE}/rpc/my_status`, 'POST', G).header).toBe(G);
    expect(new URL(scopeRequest(`${BASE}/groups?select=*`, 'GET', G).url).searchParams.has('group_id')).toBe(false);
  });
  it('leaves everything alone when no group is chosen yet (first open, or an older database)', () => {
    const url = `${BASE}/players?select=*`;
    expect(scopeRequest(url, 'GET', null)).toEqual({ url, header: null });
  });
  it('leaves photo and function requests alone', () => {
    const url = 'https://x.supabase.co/storage/v1/object/photos/a.jpg';
    expect(scopeRequest(url, 'GET', G)).toEqual({ url, header: null });
  });
});

describe('groupFolder — photos are filed per group', () => {
  it('puts a folder under the group', () => expect(groupFolder('feed', G)).toBe(`${G}/feed`));
  it('leaves an already-filed folder alone', () => expect(groupFolder(`${G}/feed`, 'other')).toBe(`${G}/feed`));
  it('keeps the old folder when no group is known', () => expect(groupFolder('avatars', null)).toBe('avatars'));
});
