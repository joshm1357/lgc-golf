import { describe, it, expect } from 'vitest';
import { nearTowns, pinNameFor, matchTowns } from './pinplace.js';

const A = [
  { name: 'Pokolbin', region: 'Hunter Valley', lat: -32.79, lng: 151.29 },
  { name: 'Cessnock', region: 'Hunter Valley', lat: -32.83, lng: 151.35 },
  { name: 'Kiama', region: 'South Coast NSW', lat: -34.67, lng: 150.85 },
  { name: 'Kiama Downs', region: 'South Coast NSW', lat: -34.63, lng: 150.85 },
];
describe('dropping a pin', () => {
  it('nearest towns first, only close ones', () => {
    const r = nearTowns({ lat: -32.80, lng: 151.30 }, A);
    expect(r.map((t) => t.name)).toEqual(['Pokolbin', 'Cessnock']);
    expect(nearTowns({ lat: -20, lng: 140 }, A)).toEqual([]);
    expect(nearTowns(null, A)).toEqual([]);
  });
  it('pre-fills a name: the town when right there, "Near …" a bit out, nothing far away', () => {
    expect(pinNameFor({ lat: -32.79, lng: 151.29 }, A)).toBe('Pokolbin');
    expect(pinNameFor({ lat: -32.81, lng: 151.31 }, A)).toBe('Near Pokolbin');
    expect(pinNameFor({ lat: -20, lng: 140 }, A)).toBe('');
  });
  it('typing a town: starts-with first, then contains, then region', () => {
    expect(matchTowns('kia', A).map((t) => t.name)).toEqual(['Kiama', 'Kiama Downs']);
    expect(matchTowns('snock', A).map((t) => t.name)).toEqual(['Cessnock']);
    expect(matchTowns('hunter', A).map((t) => t.name)).toEqual(['Cessnock', 'Pokolbin']);
    expect(matchTowns('k', A)).toEqual([]);
  });
});
