// "How it works" for each side game (23 Oct 2026). Josh: "more explanation of the side games when you open them —
// no idea what Nassau is." Plain words, a worked example, and how the money goes, written to match exactly how
// lib/games.js settles each game. Shown by components/GameHelp.jsx (the ⓘ next to a game).

export const GAME_HELP = {
  skins: {
    what: 'Every hole is worth a "skin". Win the hole outright and you win the skin.',
    steps: [
      'The lowest score on the hole wins it (with handicaps, unless the organiser set it to gross).',
      'If two or more tie for lowest, nobody wins. With carry-overs on, that skin rolls on to the next hole, so the next hole is worth 2.',
      'A pick-up never wins a hole.',
    ],
    example: '$5 skins, four of you. On the 3rd Al and Bo both make a net 4, so it carries. On the 4th Al makes a net 3 and everyone else 4 or worse: Al wins 2 skins, and collects $10 from each of the other three ($30).',
    money: 'Each skin you win, every other player pays you the stake. Skins still carried after the last hole stay in the pot.',
    options: 'Validated skins: a skin only counts if the winner at least ties the next hole as well.',
  },
  nassau: {
    what: 'Three bets in one round: best score on the front 9, best on the back 9, and best over the whole 18.',
    steps: [
      'Everyone is in each of the three bets.',
      'Lowest total wins each bet (with handicaps unless set to gross). The organiser can switch it to most Stableford points.',
      'Ties split the bet.',
    ],
    example: '$10 Nassau, four of you, so $40 in each bet. Cy has the best front 9, Di the best back 9, and Cy the best 18. Cy wins two bets ($80) and Di one ($40).',
    money: 'Everyone puts the stake into each bet. The winner of each bet takes it. The organiser can set a different amount for the front, back and 18.',
    options: 'Auto-press: when someone gets 2 (or 3) clear on a nine, a new bet starts from the next hole to the end of that nine. It gives the trailing players a way back. Up to 2 presses a nine.',
  },
  stableford_pot: {
    what: 'A simple pot: everyone puts in, and the most Stableford points for the round takes it.',
    steps: [
      'Stableford: 2 points for a net par, 3 for a net birdie, 4 for a net eagle, 1 for a net bogey, 0 for anything worse.',
      'Most points for the round wins. Ties split the pot.',
    ],
    example: '$10 pot, eight of you, so $80. Bo finishes with 38 points, the best on the day: Bo takes $80.',
    money: 'Everyone puts the stake in. The winner (or joint winners) take the lot.',
  },
  birdie_pool: {
    what: 'Everyone puts in, and the pool is shared between every birdie made.',
    steps: [
      'Each birdie or better (net, unless set to gross) earns one share.',
      'Pick-ups never count.',
      'No birdies all round? Everyone keeps their money.',
    ],
    example: '$5 each, eight of you, so $40. Three birdies get made: two by Ed, one by Fin. Each share is $13.33: Ed gets $26.67 and Fin $13.33.',
    money: 'Paid out once everyone has finished. With "eagles count double" on, an eagle takes two shares.',
  },
  eclectic: {
    what: 'Your best score on each hole, taken across all the trip’s rounds on the same course, added up into one dream round.',
    steps: [
      'Play the same course more than once on the trip and the app keeps your best score on each hole.',
      'Lowest total of those best scores wins (with handicaps unless set to gross).',
      'You need a score on every hole to win it.',
    ],
    example: 'Two rounds at Kiama. You make a 3 on the 5th on Saturday and a 6 there on Sunday: your eclectic counts the 3. Do that for all 18 and add them up.',
    money: 'Everyone who played one of those rounds is in for the stake. Decided once every round on that course is locked.',
  },
};

/** Help for a game row (custom games add their house rules). */
export function helpFor(kind) {
  return GAME_HELP[kind] || null;
}
