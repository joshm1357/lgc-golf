import { describe, it, expect } from 'vitest';
import {
  tripDays, addDays, forecastWindow, courseSpot, tripPlace, placeQuery, pickPlace, forecastUrl, currentUrl, geocodeUrl,
  cacheKey, hourStamp, isFresh, parseDaily, parseCurrent, compass, windWords, clubHint, windLine, weatherLook,
  packingHints, rowsForDays, showRoundWeather,
} from './weather.js';

describe('trip days and the forecast window', () => {
  it('lists every day of a trip', () => {
    expect(tripDays('2026-10-30', '2026-11-01')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(tripDays('2026-10-30')).toEqual(['2026-10-30']);
    expect(tripDays(null)).toEqual([]);
  });
  it('adds days across a month end', () => expect(addDays('2026-10-30', 3)).toBe('2026-11-02'));
  it('shows days inside the 16-day window', () => {
    const w = forecastWindow(tripDays('2026-10-23', '2026-10-25'), '2026-10-21');
    expect(w.state).toBe('show');
    expect(w.show).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
    expect(w.rough).toBe(false);
  });
  it('a trip more than a week out is a rough guide', () => {
    expect(forecastWindow(['2026-11-01'], '2026-10-21').rough).toBe(true);
  });
  it('only the days in the window when a trip straddles the edge', () => {
    const w = forecastWindow(tripDays('2026-11-04', '2026-11-07'), '2026-10-21');
    expect(w.show).toEqual(['2026-11-04', '2026-11-05']); // today + 15 = 5 Nov
  });
  it('too far out: says when it shows up', () => {
    const w = forecastWindow(['2026-12-12', '2026-12-13'], '2026-10-21');
    expect(w).toMatchObject({ state: 'soon', show: [], opensOn: '2026-11-27' });
  });
  it('a finished trip and a trip with no dates show nothing', () => {
    expect(forecastWindow(['2026-10-01'], '2026-10-21').state).toBe('past');
    expect(forecastWindow([], '2026-10-21').state).toBe('none');
  });
  it('a trip that is on now shows today onwards', () => {
    expect(forecastWindow(tripDays('2026-10-20', '2026-10-22'), '2026-10-21').show).toEqual(['2026-10-21', '2026-10-22']);
  });
});

describe('where the weather is for', () => {
  const course = { id: 'c1', name: 'Cypress Lakes', holes: [{ n: 1, green: { lat: -32.8, lng: 151.3 } }, { n: 2, green: { lat: -32.82, lng: 151.32 } }, { n: 3 }] };
  const unmapped = { id: 'c2', name: 'Nowhere GC', holes: [{ n: 1 }] };
  it('the middle of the greens', () => {
    const s = courseSpot(course);
    expect(s.lat).toBeCloseTo(-32.81);
    expect(s.lng).toBeCloseTo(151.31);
    expect(s.name).toBe('Cypress Lakes');
  });
  it('falls back to tees, then nothing', () => {
    expect(courseSpot({ name: 'T', holes: [{ tee: { lat: -30, lng: 150 } }] })).toMatchObject({ lat: -30, lng: 150 });
    expect(courseSpot(unmapped)).toBeNull();
    expect(courseSpot(null)).toBeNull();
  });
  it('a trip uses its soonest mapped course, then the copied courses, then the place name', () => {
    const coursesById = { c1: course, c2: unmapped };
    const plan = { trip_id: 't1', location_name: 'Hunter Valley, NSW' };
    const rounds = [{ trip_id: 't1', course_id: 'c2', play_date: '2026-10-23' }, { trip_id: 't1', course_id: 'c1', play_date: '2026-10-24' }, { trip_id: 'other', course_id: 'c1' }];
    expect(tripPlace({ plan, rounds, coursesById }).name).toBe('Cypress Lakes');
    expect(tripPlace({ plan: { location_name: 'X' }, rounds, coursesById, shapeCourseIds: ['c1'] }).name).toBe('Cypress Lakes');
    expect(tripPlace({ plan, rounds: [], coursesById })).toEqual({ query: 'Hunter Valley' });
    expect(tripPlace({ plan: {}, rounds: [], coursesById })).toBeNull();
  });
  it('cleans a place name for the place search', () => {
    expect(placeQuery('Port Macquarie, NSW')).toBe('Port Macquarie');
    expect(placeQuery('Bowral NSW 2576')).toBe('Bowral');
    expect(placeQuery('Barnbougle (Tas)')).toBe('Barnbougle');
    expect(placeQuery('  ')).toBe('');
  });
  it('picks an Australian match first', () => {
    const json = { results: [{ name: 'Bowral', latitude: 1, longitude: 2, country_code: 'US' }, { name: 'Bowral', admin1: 'New South Wales', latitude: -34.48, longitude: 150.42, country_code: 'AU' }] };
    expect(pickPlace(json)).toEqual({ lat: -34.48, lng: 150.42, name: 'Bowral, New South Wales' });
    expect(pickPlace({ results: [{ name: 'Queenstown', latitude: -45, longitude: 168.6, country_code: 'NZ' }] }).name).toBe('Queenstown');
    expect(pickPlace({})).toBeNull();
  });
});

describe('the Open-Meteo addresses and the saved copy', () => {
  it('asks for the right things, coordinates rounded', () => {
    const u = new URL(forecastUrl(-32.81234, 151.3099));
    expect(u.host).toBe('api.open-meteo.com');
    expect(u.searchParams.get('latitude')).toBe('-32.81');
    expect(u.searchParams.get('longitude')).toBe('151.31');
    expect(u.searchParams.get('daily')).toContain('precipitation_probability_max');
    expect(u.searchParams.get('daily')).toContain('wind_gusts_10m_max');
    expect(u.searchParams.get('forecast_days')).toBe('16');
    expect(new URL(currentUrl(-32.8, 151.3)).searchParams.get('current')).toContain('wind_speed_10m');
    expect(new URL(geocodeUrl('Port Macquarie')).searchParams.get('name')).toBe('Port Macquarie');
  });
  it('one saved copy per place per hour', () => {
    expect(cacheKey('daily', -32.81234, 151.3099)).toBe('lgc-wx-daily--32.81,151.31');
    const at = new Date(2026, 9, 21, 9, 15);
    expect(hourStamp(at)).toBe('2026-10-21T09');
    expect(isFresh({ hour: '2026-10-21T09', data: {} }, at)).toBe(true);
    expect(isFresh({ hour: '2026-10-21T08', data: {} }, at)).toBe(false);
    expect(isFresh(null, at)).toBe(false);
  });
});

const DAILY = {
  daily: {
    time: ['2026-10-23', '2026-10-24', '2026-10-25'],
    weather_code: [1, 61, 95],
    temperature_2m_max: [24.4, 19.1, 31.6],
    temperature_2m_min: [12.2, 8.6, 17],
    precipitation_probability_max: [5, 70, 40],
    precipitation_sum: [0, 6.2, 3],
    wind_speed_10m_max: [14, 31, 18],
    wind_gusts_10m_max: [25, 52, 30],
    wind_direction_10m_dominant: [225, 180, 90],
  },
};

describe('reading the answers', () => {
  it('daily rows', () => {
    const rows = parseDaily(DAILY);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ date: '2026-10-24', code: 61, max: 19.1, min: 8.6, rain: 70, rainMm: 6.2, wind: 31, gust: 52, dir: 180 });
    expect(parseDaily({})).toEqual([]);
  });
  it('current conditions', () => {
    const c = parseCurrent({ current: { temperature_2m: 21.3, apparent_temperature: 19, precipitation: 0, weather_code: 2, wind_speed_10m: 17, wind_gusts_10m: 29, wind_direction_10m: 200 }, daily: { precipitation_probability_max: [20] } });
    expect(c).toEqual({ temp: 21.3, feels: 19, rainMm: 0, code: 2, wind: 17, gust: 29, dir: 200, rain: 20 });
    expect(parseCurrent({})).toBeNull();
  });
  it('rows for the shown days only, in order', () => {
    expect(rowsForDays(parseDaily(DAILY), ['2026-10-24', '2026-10-26']).map((r) => r.date)).toEqual(['2026-10-24']);
  });
});

describe('wind and weather in words', () => {
  it('compass points (where it comes from)', () => {
    expect(compass(0)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(compass(350)).toBe('N');
    expect(compass(-45)).toBe('NW');
    expect(compass(null)).toBe('');
  });
  it('wind words', () => {
    expect(windWords(3)).toBe('Calm');
    expect(windWords(15)).toBe('Gentle breeze');
    expect(windWords(25)).toBe('Breezy');
    expect(windWords(35)).toBe('Windy');
    expect(windWords(60)).toBe('Blowing a gale');
    expect(windWords(null)).toBe('');
  });
  it('clubs into the wind', () => {
    expect(clubHint(8)).toBe('');
    expect(clubHint(18)).toBe('about a club into it');
    expect(clubHint(30)).toBe('two clubs into it');
    expect(clubHint(45)).toMatch(/three/);
  });
  it('a short wind line, gusts only when they matter', () => {
    expect(windLine(18, 225, 30)).toBe('18 km/h SW, gusts 30');
    expect(windLine(18, 225, 20)).toBe('18 km/h SW');
    expect(windLine(null)).toBe('');
  });
  it('weather pictures', () => {
    expect(weatherLook(0)).toEqual({ icon: '☀️', word: 'Sunny' });
    expect(weatherLook(63).word).toBe('Showers');
    expect(weatherLook(99).word).toBe('Storms');
    expect(weatherLook(1234).word).toBe('');
  });
});

describe('what to pack', () => {
  it('jumper, storms, rain, sun and wind — most useful first, at most 4', () => {
    const hints = packingHints(parseDaily(DAILY));
    expect(hints).toHaveLength(4);
    expect(hints[0]).toBe('🧥 Bring a jumper — 9° first thing Saturday');
    expect(hints[1]).toMatch(/Storms possible Sunday/);
    expect(hints[2]).toBe('☔ Pack the wet-weather gear — 70% chance of rain Saturday');
    expect(hints[3]).toMatch(/Sunscreen.*32° Sunday/);
  });
  it('wind gets a mention on a blowy day', () => {
    expect(packingHints([{ date: '2026-10-24', min: 15, max: 22, rain: 10, wind: 33, gust: 50, code: 2 }])).toEqual(['🌬️ Windy Saturday — practise the knock-down']);
  });
  it('nice weather says so; no days says nothing', () => {
    expect(packingHints([{ date: '2026-10-24', min: 14, max: 23, rain: 10, wind: 10, gust: 15, code: 1 }])[0]).toMatch(/golfing weather/);
    expect(packingHints([])).toEqual([]);
  });
});

describe('the leaderboard chip', () => {
  it('only for a live round played today', () => {
    expect(showRoundWeather({ status: 'live', play_date: '2026-10-21' }, '2026-10-21')).toBe(true);
    expect(showRoundWeather({ status: 'live', play_date: null }, '2026-10-21')).toBe(true);
    expect(showRoundWeather({ status: 'live', play_date: '2026-10-20' }, '2026-10-21')).toBe(false);
    expect(showRoundWeather({ status: 'locked', play_date: '2026-10-21' }, '2026-10-21')).toBe(false);
    expect(showRoundWeather(null, '2026-10-21')).toBe(false);
  });
});
