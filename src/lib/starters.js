// Starter rulebooks a new group can pick (Stage 5). The rules themselves are in migration 032
// (use_starter_rulebook, updated in 032b); this is what the picker shows — starters.test.js checks the two match. Everything can be edited afterwards.
export const STARTERS = [
  {
    key: 'social_stableford',
    name: 'Social Stableford weekend',
    blurb: 'Everyone plays Stableford; points add up over the weekend.',
    rules: ['Stableford, full handicap', 'Pick up when you can’t score', 'Handicaps', 'Ready golf'],
  },
  {
    key: 'ambrose_stableford',
    name: 'Ambrose and Stableford',
    blurb: 'A trip with both: Stableford for the trip trophy, Ambrose teams with side comps and minimum drives.',
    rules: ['Stableford counts for the trip trophy', 'Ambrose net = gross minus team handicap', 'Team handicap', 'Minimum drives (4 each)',
      'Closest to pin (−2 strokes)', 'Longest drive (−2 strokes)', 'Handicap changes'],
  },
  {
    key: 'just_scoring',
    name: 'Just scoring',
    blurb: 'No extras — the round sets the format and the app does the maths.',
    rules: ['The round sets the format', 'Handicaps'],
  },
];
