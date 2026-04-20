/**
 * Total market principles.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Only the Principle type from ../types.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'T1',
    bucket: 'market',
    title: 'Public over-bias is structural',
    body: `Recreational bettors prefer overs. Always. Sportsbooks know this and shade totals upward to capture over-money. A total that moves DOWN despite public ticket % on the over is higher-conviction RLM than an equivalent spread move — it's fighting both sharp signal direction and the book's own public-bias shading.`,
    last_validated: '2026-04-19',
    tags: ['rlm', 'public-bias'],
  },
  {
    id: 'T2',
    bucket: 'market',
    title: 'Total juice moves are underrated',
    body: `Totals often move in stiff 0.5-point increments because books won't cross half-points freely. Sharp action hits the juice first — Over -110 → -125, Under -110 → +105 — before the number itself moves. A flat total with 15 cents of juice movement toward one side is a live signal that will become a number-move if sustained.`,
    last_validated: '2026-04-19',
    tags: ['juice'],
  },
  {
    id: 'T3',
    bucket: 'market',
    title: 'Weather and lineup drive totals more than spreads',
    body: `Injury to a defender shifts a total more than a spread. Wind in outdoor football moves totals by 3-5 points while leaving spreads flat. Bullpen availability shifts MLB totals. When a total moves and a spread doesn't, suspect informational causation (U3) before sharp causation — especially in weather-exposed sports.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'T4',
    bucket: 'market',
    title: 'Key numbers on totals are sport-specific',
    body: `NFL totals cluster at keys 41, 44, 47, 51. NBA totals have weak keys. NHL totals key at 5.5 and 6.5. MLB totals key at 7, 8, 9. Crossing a key matters; moving within one doesn't, much.`,
    last_validated: '2026-04-19',
    tags: ['key-numbers'],
  },
  {
    id: 'T5',
    bucket: 'market',
    title: 'Total vs side divergence is a signal',
    body: `If sharp money is on a team's spread but the total is flat, that's information — pros think the team wins without necessarily shifting game pace. If both move together (spread toward home, total up), the read is "home team takes over the game." Co-movement and divergence are different signals; HSA must distinguish.`,
    last_validated: '2026-04-19',
  },
];
