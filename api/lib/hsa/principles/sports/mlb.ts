/**
 * MLB sport principles.
 *
 * Structural invariant: this file imports ONLY from ../types. No imports
 * between principle files.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'MLB1',
    bucket: 'sport',
    title: 'Starting pitcher is the dominant variable',
    body: `Pitcher matchup accounts for more line movement than any other factor. Lineups, bullpen, and park factor follow. If the pitcher changes, the line should be treated as a new market — not as continuous with the prior line. Applies across spread (run line juice), ML, and total.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB2',
    bucket: 'sport',
    title: 'Run line is stuck at ±1.5',
    body: `The spread is frozen by convention. Signal expresses exclusively through the two juice sides moving against each other. A "frozen run line" read without juice data is a blind read.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB3',
    bucket: 'sport',
    title: 'Moneyline is primary',
    body: `Unlike spread-primary sports, MLB's real price discovery happens on the ML. Sharp action hits ML first; run line juice confirms or contradicts. HSA should treat ML movement as the leading indicator.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB4',
    bucket: 'sport',
    title: 'Bullpen fatigue is a totals signal',
    body: `Teams with 3+ relievers used in the prior 2 days have compromised late-game run suppression. Bullpen fatigue drives total moves upward in ways spreads don't reflect. Often missed by public; priced by sharps.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB5',
    bucket: 'sport',
    title: 'Weather and park interact',
    body: `Wind direction at Wrigley, Coors altitude, humidity in summer Boston, marine layer at Oracle — each shifts totals by 0.5-1.5 runs. Wind blowing in vs out at Wrigley is a 1.5-run swing on the same pitcher matchup. Roof status (open/closed) matters where applicable.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB6',
    bucket: 'sport',
    title: 'Lineup posting is a discrete event',
    body: `Lineups post 3-4 hours before first pitch. Star rest days, platoon swaps, and catcher changes move totals and sides. Pre-lineup lines are inherently softer than post-lineup lines. Sharp action often waits for lineup confirmation.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB7',
    bucket: 'sport',
    title: 'Umpire edges are gone in 2026',
    body: `ABS Challenge System eliminated the primary umpire-based total edge (strike zone consistency). Historical pre-2026 data conflating umpire-driven moves with sharp signals is now misleading.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB8',
    bucket: 'sport',
    title: 'F5 (first 5 innings) removes bullpen noise',
    body: `F5 totals and F5 sides are cleaner reads than full-game because they isolate the starters. Sharp action frequently concentrates on F5 when the full-game ML juice feels priced but the starter matchup is mispriced.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'MLB9',
    bucket: 'sport',
    title: 'Public loves favorites and overs',
    body: `Both biases compound in MLB. Expensive MLB favorites (Dodgers, Yankees, Braves) are structurally shaded. Overs are shaded up across the board. Unders on road dogs are the statistically sharpest structural fade.`,
    last_validated: '2026-04-20',
  },
];
