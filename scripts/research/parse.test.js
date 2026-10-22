import { describe, it, expect } from 'vitest';
import {
  parseCsv, courseKey, importKey, matchKeys, townKeys, parseFee, parseDriveHours, parseHoles, parsePar, parseCartRequired,
  parseGoodForGroups, parseAccessType, parseChecked, urlsIn, toPayloadRow, toPayloadRows, matchCourse, splitArea, parseGuide, guideStates,
  looseKey,
} from './parse.js';

describe('CSV', () => {
  it('reads quotes, doubled quotes, commas and new lines inside quotes', () => {
    const rows = parseCsv('name,notes\r\n"Bowral GC","says ""hi"", then\nmore"\nKiama,plain\n');
    expect(rows).toEqual([{ name: 'Bowral GC', notes: 'says "hi", then\nmore' }, { name: 'Kiama', notes: 'plain' }]);
  });
});

describe('names', () => {
  it('drops Golf Club, Country Club, GC, punctuation and & / and', () => {
    expect(courseKey('Bowral Golf Club')).toBe('bowral');
    expect(courseKey('Bowral GC')).toBe('bowral');
    expect(courseKey('The Bowral Country Club')).toBe('bowral');
    expect(courseKey("St Michael's Golf Club")).toBe('stmichaels');
    expect(courseKey('Coolangatta & Tweed Heads Golf Club')).toBe(courseKey('Coolangatta and Tweed Heads GC'));
    expect(importKey('Bowral Golf Club', 'nsw')).toBe('bowral|NSW');
  });
  it('tries a single name in brackets, never a list or a plain word', () => {
    expect(matchKeys('Easts Leisure & Golf (Maitland Golf Club)')).toEqual(['eastsleisure', 'maitland']);
    expect(matchKeys('Palmer Gold Coast (formerly Robina Woods)')).toEqual(['palmergoldcoast', 'robinawoods']);
    expect(matchKeys('Royal Melbourne Golf Club (West, East)')).toEqual(['royalmelbourne']);
    expect(matchKeys('Moonah Links Resort (Open & Legends)')).toEqual(['moonah']);
    expect(matchKeys('Paradise Palms (closed)')).toEqual(['paradisepalms']);
    expect(matchKeys('Club Taree (Taree Golf Course)?', 'Taree')).toEqual(['taree']);
    expect(matchKeys('Gibraltar 9-hole course (Bowral) - note only', 'Bowral')).toEqual(['gibraltar9holenoteonly']);
  });
  it('splits towns and drops street addresses', () => {
    expect(townKeys('Marrangaroo (Lithgow)')).toEqual(['marrangaroo', 'lithgow']);
    expect(townKeys('Pambula / Merimbula')).toEqual(['pambula', 'merimbula']);
    expect(townKeys('Kew (185 Kendall Rd)')).toEqual(['kew']);
    expect(townKeys('Bunbury area?')).toEqual(['bunbury']);
  });
});

describe('typed columns', () => {
  it('fees: the number when clear', () => {
    expect(parseFee('55 for 18 walking; cart +50 (club golf page, Oct 2026)')).toBe(55);
    expect(parseFee('37.50 walking 18 holes non-member')).toBe(37.5);
    expect(parseFee('~200 visitor (Experience Magenta)')).toBe(200);
    expect(parseFee('$65 walking')).toBe(65);
  });
  it('fees: unclear → null', () => {
    expect(parseFee('22? (third-party guide, date unknown - confirm)')).toBeNull();
    expect(parseFee('~35 (Golf Australia, Sep 2022)')).toBeNull(); // years old
    expect(parseFee('(2022 GA: 40 every day)')).toBeNull();
    expect(parseFee('See Golf Shop Pricing PDF')).toBeNull();
    expect(parseFee('Tuncurry 75 / Forster 60')).toBeNull();
    expect(parseFee('')).toBeNull();
  });
  it('drive hours from Sydney; a flight is not a drive', () => {
    expect(parseDriveHours('3.0')).toBe(3);
    expect(parseDriveHours('2.0 h')).toBe(2);
    expect(parseDriveHours('~7')).toBe(7);
    expect(parseDriveHours('2.0-2.5 h')).toBe(2);
    expect(parseDriveHours('45 min')).toBe(0.75);
    expect(parseDriveHours('~9 (or fly SYD-OOL + 15 min)')).toBe(9);
    expect(parseDriveHours('fly SYD–MEL + 1.25 h drive')).toBeNull();
    expect(parseDriveHours('')).toBeNull();
  });
  it('holes and par; "?" means not sure', () => {
    expect(parseHoles('18')).toBe(18);
    expect(parseHoles('36 (North, South)')).toBe(36);
    expect(parseHoles('18?')).toBeNull();
    expect(parseHoles('? (Golf NSW lists 9)')).toBeNull();
    expect(parsePar('70 (men)')).toBe(70);
    expect(parsePar('72?')).toBeNull();
    expect(parsePar('East 72; West 71')).toBeNull();
  });
  it('cart required, good for groups, access type, checked date', () => {
    expect(parseCartRequired('No - walking permitted')).toBe(false);
    expect(parseCartRequired('Yes - cart included')).toBe(true);
    expect(parseCartRequired('Cart included in 18-hole rate')).toBe(true);
    expect(parseCartRequired('likely (cart included in visitor rate)?')).toBeNull();
    expect(parseGoodForGroups('4 - ranked course, pairs with Pambula')).toBe(4);
    expect(parseGoodForGroups('')).toBeNull();
    expect(parseAccessType('semi_private')).toBe('semi_private');
    expect(parseAccessType('Stay and play only')).toBe('stay_and_play_only');
    expect(parseAccessType('private?')).toBeNull();
    expect(parseAccessType('stay_and_play_only')).toBe('stay_and_play_only');
    expect(parseChecked('Oct 2026 (fees not confirmed)')).toBe('2026-10-01');
    expect(parseChecked('not verified - check with club')).toBeNull();
  });
  it('web links', () => {
    expect(urlsIn('https://a.com/x https://b.com/y. https://a.com/x')).toEqual(['https://a.com/x', 'https://b.com/y']);
  });
});

describe('a row', () => {
  const row = {
    name: 'Bermagui Country Club', suburb_or_town: 'Bermagui', state: 'NSW', region: 'Bega Valley / Sapphire Coast', holes: '18', par: '72',
    green_fee_weekday_aud: '55 for 18 walking; cart +50 (club golf page, Oct 2026)', green_fee_weekend_aud: '', access_type: 'public',
    good_for_groups: '', drive_from_sydney_cbd: '5.0', online_booking_url: '', group_enquiry_url: 'https://www.bermaguicountryclub.com/golf',
    website: 'https://www.bermaguicountryclub.com/', phone: '02 6493 4340 (club)', email: 'glen@example.com', last_checked: 'Oct 2026',
    sources: 'https://www.golfnsw.org.au/x https://www.bermaguicountryclub.com/', members_times: 'Comp days Tue, Wed, Thu, Sat',
  };
  it('typed where clear, the words in details', () => {
    const p = toPayloadRow(row);
    expect(p).toMatchObject({
      import_key: 'bermagui|NSW', name: 'Bermagui Country Club', town: 'Bermagui', state: 'NSW', holes: 18, par: 72, fee_weekday: 55, fee_weekend: null,
      access_type: 'public', drive_from_sydney_hours: 5, group_enquiry_url: 'https://www.bermaguicountryclub.com/golf', booking_url: null,
      last_checked: '2026-10-01',
    });
    // Plain name and town: the database works the match keys out itself, so they aren't sent.
    expect(p).not.toHaveProperty('match_keys');
    expect(p).not.toHaveProperty('match_towns');
    expect(toPayloadRow({ ...row, name: 'Easts (Maitland Golf Club)', suburb_or_town: 'Marrangaroo (Lithgow)' }))
      .toMatchObject({ match_keys: ['easts', 'maitland'], match_towns: ['marrangaroo', 'lithgow'] });
    // Words that say no more than the typed column aren't repeated in details.
    expect(p.details.holes).toBeUndefined();
    expect(p.details.drive_from_sydney_cbd).toBeUndefined();
    expect(p.details.last_checked).toBeUndefined();
    expect(p.sources).toHaveLength(2);
    expect(p.details.members_times).toBe('Comp days Tue, Wed, Thu, Sat');
    expect(p.details.green_fee_weekday_aud).toContain('cart +50');
    expect(p.details.name).toBeUndefined();
  });
  it('no name or a bad state → skipped; same name and state twice → the town keeps them apart', () => {
    const { rows, skipped } = toPayloadRows([row, { ...row, state: 'XX' }, { ...row, suburb_or_town: 'Other Town' }]);
    expect(skipped).toEqual(['Bermagui Country Club']);
    expect(rows.map((r) => r.import_key)).toEqual(['bermagui|NSW', 'bermagui|NSW|othertown']);
  });
});

describe('matching to the library', () => {
  const lib = [
    { id: 'a', name: 'Bowral Golf Club', area: 'Bowral NSW', lat: -34.48, lng: 150.42 },
    { id: 'b', name: 'Queanbeyan Golf Club', area: 'Greenleigh NSW', lat: -35.33, lng: 149.25 },
    { id: 'c', name: 'Wentworth Golf Course', area: 'Wentworth NSW', lat: -34.1, lng: 141.9 },
    { id: 'd', name: 'Duntryleague GC', area: 'Orange NSW', lat: -33.29, lng: 149.08 },
    { id: 'e', name: 'Dural Golf Driving Range', area: 'Dural NSW', lat: -33.68, lng: 151.03 },
    { id: 'f', name: 'Kiama Golf Club', area: 'Kiama Downs NSW', lat: -34.63, lng: 150.85 },
    { id: 'g', name: 'Bowral Golf Club', area: 'Bowral VIC', lat: -37, lng: 145 },
    { id: 'h', name: 'Torquay Sands Golf Club', area: 'Torquay VIC', lat: -38.32, lng: 144.31 },
    { id: 'i', name: 'Saint Andrews Beach Golf Club', area: 'Fingal VIC', lat: -38.41, lng: 144.85 },
    { id: 'j', name: 'Mount Broughton Golf and Country Club', area: 'Moss Vale NSW', lat: -34.55, lng: 150.37 },
    { id: 'k', name: 'The Ridge Golf Course & Driving Range', area: 'Barden Ridge NSW', lat: -34.03, lng: 151.0 },
    { id: 'l', name: 'Sands Golf Club', area: 'Perth WA', lat: -32, lng: 115.9 },
  ];
  const m = (name, town, state = 'NSW', access_type = 'public') => matchCourse({ name, town, state, access_type }, lib);
  it('exact: same name, state and town', () => expect(m('Bowral GC', 'Bowral')).toEqual({ match: 'exact', id: 'a' }));
  it('near: same name, the suburb next door', () => expect(m('Queanbeyan Golf Club', 'Queanbeyan')).toEqual({ match: 'near', id: 'b' }));
  it('not the same-named course 600 km away', () => expect(m('Wentworth Golf Club', 'Orange')).toEqual({ match: 'new', id: null }));
  it('never a driving range', () => expect(m('Dural Country Club', 'Dural')).toEqual({ match: 'new', id: null }));
  it('a name in brackets', () => expect(m('Easts Leisure & Golf (Duntryleague Golf Club)', 'Orange')).toEqual({ match: 'exact', id: 'd' }));
  it('state matters', () => expect(m('Bowral Golf Club', 'Bowral', 'VIC')).toEqual({ match: 'exact', id: 'g' }));
  it('closed and not in the library → unmatched (not added)', () => expect(m('Gone Golf Club', 'Nowhere', 'NSW', 'closed')).toEqual({ match: 'unmatched', id: null }));
  it('a note-only row is not added', () => expect(m('Gibraltar 9-hole course (Bowral) - note only', 'Bowral')).toEqual({ match: 'unmatched', id: null }));
  it('loose: words in another order', () => expect(m('Sands Torquay Golf Club', 'Torquay (2 Sands Boulevard)', 'VIC')).toEqual({ match: 'near', id: 'h' }));
  it('loose: St / Saint and Mt / Mount', () => {
    expect(m('St Andrews Beach Golf Course', 'Fingal', 'VIC')).toEqual({ match: 'near', id: 'i' });
    expect(m('Mt Broughton Golf & Country Club', 'Sutton Forest (Moss Vale)')).toEqual({ match: 'near', id: 'j' });
  });
  it('loose: a course that also has a range counts', () => expect(m('The Ridge Golf Course', 'Lucas Heights?')).toEqual({ match: 'near', id: 'k' }));
  it('looseKey', () => {
    expect(looseKey('Sands Torquay Golf Club')).toBe(looseKey('Torquay Sands Golf Club'));
    expect(looseKey('Canterbury Public Golf Course')).toBe('canterbury');
    expect(looseKey('Gladstone Golf Club (Yaralla Golf Course)')).toBe('gladstone');
  });
  it('splits areas', () => expect(splitArea('Kiama Downs NSW')).toEqual({ town: 'kiamadowns', state: 'NSW' }));
});

describe('the region guide', () => {
  const md = `# Title (October 2026)

Intro line.

## How to read access in the dataset

| access_type | What it means |
|---|---|
| public | Anyone can book. |

**Member times:** Wednesday and Saturday mornings are men's comps.

Many clubs offer more than one route.

## Booking platforms and golf deal sites used in Australia

- **MiClub**: common.

---

# Region guides

## NSW: Sydney

Eastlake is $75 weekdays.

## NSW & ACT: Illawarra, South Coast, Canberra

Kiama and Gerringong.

## Tasmania

Barnbougle.
`;
  const rows = [
    { name: 'Eastlake Golf Club', state: 'NSW', region: 'Sydney – Eastern Suburbs' },
    { name: 'Kiama Golf Club', state: 'NSW', region: 'Illawarra' },
    { name: 'Royal Canberra Golf Club', state: 'ACT', region: 'Canberra' },
    { name: 'Barnbougle', state: 'TAS', region: 'North East Tasmania' },
  ];
  const g = parseGuide(md, rows);
  const by = Object.fromEntries(g.map((x) => [x.key, x]));
  it('general sections, with member times on their own', () => {
    expect(Object.keys(by)).toEqual(['about', 'access-types', 'member-times', 'booking-platforms', 'nsw-sydney', 'nsw-and-act-illawarra-south-coast-canberra', 'tasmania']);
    expect(by['member-times'].body).toMatch(/^\*\*Member times:\*\* Wednesday/);
    expect(by['access-types'].body).toContain('| public |');
    expect(by['access-types'].body).toContain('more than one route');
    expect(by['access-types'].body).not.toContain('Member times');
  });
  it('regions: states from the heading, dataset regions by which section names their courses', () => {
    expect(by['nsw-sydney']).toMatchObject({ kind: 'region', state: 'NSW', regions: ['Sydney – Eastern Suburbs'] });
    expect(by['nsw-and-act-illawarra-south-coast-canberra']).toMatchObject({ state: 'NSW/ACT', regions: ['Canberra', 'Illawarra'] });
    expect(by.tasmania).toMatchObject({ state: 'TAS', regions: ['North East Tasmania'] });
    expect(guideStates('WA and NT')).toEqual(['WA', 'NT']);
  });
});
