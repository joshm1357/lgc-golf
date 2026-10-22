import { describe, it, expect } from 'vitest';
import { aboutLines, checkedLabel, contactLinks, shortFacts, memberWarning, feesText, stars, tidy, safeUrl } from './courseresearch.js';
import { callScript } from './teegrid.js';

const row = {
  library_id: 'x', name: 'The Vintage Golf Club', town: 'Pokolbin', state: 'NSW', fee_weekday: 150, fee_weekend: 180, access_type: 'public',
  good_for_groups: 5, drive_from_sydney_hours: 2.25, booking_url: 'https://thevintage.miclub.com.au/x', group_enquiry_url: 'https://thevintage.com.au/groups',
  website: 'javascript:alert(1)', phone: '(02) 4998 6789 (pro shop); club 02 4998 0000', email: 'golf@thevintage.com.au; info@x.com', last_checked: '2026-10-01',
  sources: ['https://a.example/x', 'not a link'],
  details: {
    style: 'parkland', difficulty: '4 - water on 8 holes', members_times: 'Wed and Sat mornings are member comps until 11:30am (club site, Oct 2026)',
    visitor_times: 'Public 7 days', stay_and_play: 'Chateau Elan packages', good_for_groups: '5 - rooms on site', access_route: 'Book online',
    group_bookings_how: 'Golf shop for 12+',
  },
};

describe('About this course for groups', () => {
  it('rows in plain words, source notes trimmed, stars for groups', () => {
    const lines = Object.fromEntries(aboutLines(row).map((l) => [l.label, l.value]));
    expect(lines.Style).toBe('parkland · water on 8 holes');
    expect(lines['Getting a game']).toBe('Public — anyone can book. Book online');
    expect(lines.Fees).toBe('$150 weekdays · $180 weekends');
    expect(lines['Members have']).toBe('Wed and Sat mornings are member comps until 11:30am');
    expect(lines['Good for groups']).toBe('★★★★★ rooms on site');
    expect(lines['How to book']).toBe('Golf shop for 12+');
    expect(lines['Drive from Sydney']).toBe('about 2.25 h');
    expect(aboutLines(null)).toEqual([]);
  });
  it('researched date and "check with the club"', () => {
    expect(checkedLabel(row)).toBe('Researched Oct 2026 — check with the club');
    expect(checkedLabel({})).toBe('Not checked yet — check with the club');
  });
  it('links: only real web links; a dialable phone; the first email', () => {
    const c = contactLinks(row);
    expect(c.booking).toBe(row.booking_url);
    expect(c.website).toBeNull(); // never a javascript: link
    expect(c.tel).toBe('0249986789');
    expect(c.email).toBe('golf@thevintage.com.au');
    expect(safeUrl('https://ok.example/a')).toBe('https://ok.example/a');
    expect(safeUrl('ftp://x')).toBeNull();
  });
  it('fees and stars', () => {
    expect(feesText({ fee_weekday: 55, fee_weekend: 55 })).toBe('$55 (18 holes)');
    expect(feesText({ details: { green_fee_weekday_aud: 'Ring golf shop (club site Oct 2026)' } })).toBe('Ring golf shop');
    expect(stars(3)).toBe('★★★☆☆');
    expect(tidy('55 walking (club golf page, Oct 2026); cart +50')).toBe('55 walking; cart +50');
  });
});

describe('trip builder row and the call', () => {
  it('one short line for a course row', () => {
    expect(shortFacts(row)).toBe('Public · $150–180 · groups ★★★★★ · stay & play');
    expect(shortFacts({ access_type: 'handicap_visitor' })).toBe('Handicap needed');
    expect(shortFacts(null)).toBe('');
  });
  it('member warning names the trip days it touches', () => {
    const w = memberWarning(row, ['2027-03-12', '2027-03-13', '2027-03-14']); // Fri, Sat, Sun
    expect(w.days).toEqual(['Sat']);
    expect(w.text).toMatch(/^Members have: Wed and Sat mornings.*touches your Sat: ask for times outside it\.$/);
    expect(memberWarning(row, ['2027-03-15']).text).toMatch(/ask for times outside these\.$/); // a Monday
    expect(memberWarning({ details: {} }, [])).toBeNull();
    expect(memberWarning({ access_type: 'member_intro_only', details: {} }).text).toMatch(/a group can’t book here/);
  });
  it('the call script asks around the members’ days (and is unchanged without research)', () => {
    expect(callScript({ course: 'The Vintage', need: 3, dates: ['2027-03-13'], memberDays: ['Sat'] })).toMatch(/members have the course on Sat — what could we get around that\?/);
    expect(callScript({ course: 'The Vintage', need: 3, dates: ['2027-03-13'] })).not.toMatch(/members have/);
  });
});
