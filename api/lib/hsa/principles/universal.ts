/**
 * Universal HSA principles — apply to every market and every sport.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Slot prompts compose principles by importing from multiple files;
 * principle files do not depend on each other.
 */

import type { Principle } from './types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'U1',
    bucket: 'universal',
    title: "Closing line is the market's best estimate",
    body: `The final line incorporates all available information. HSA's job is to detect when the current line is mispriced relative to where it's heading. We flag setups where CLV is likely positive, not games we predict will win. Different claims.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'U2',
    bucket: 'universal',
    title: 'Books move prices to attract the losing side',
    body: `When a price gets better on Side A, money was coming in on Side B. Always. HSA describes money-on, not line-moved-on. Getting this backwards corrupts every read. Applied to cents: +140 → +155 on Team A means money on Team B. -180 → -165 on a favorite means money on the dog. -110 → +110 means 20 cents of money on the opposite side.`,
    last_validated: '2026-04-19',
    tags: ['inversion', 'direction'],
  },
  {
    id: 'U3',
    bucket: 'universal',
    title: 'Line movement has two causes — distinguish them',
    body: `Lines move from (a) new information (injury, weather, lineup) or (b) money rebalancing. HSA narrates (b). When (a) is suspected, do not overclaim sharp intent.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'U4',
    bucket: 'universal',
    title: 'Rare fires are correct fires',
    body: `A detection system firing on most games produces noise. Most grades should be PASS. Action grades are the exception, triggered only when multiple signals align — not when any single threshold crosses.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'U5',
    bucket: 'universal',
    title: 'Confirmation-first',
    body: `A single signal is a hypothesis. Confirmed signals require agreement across line direction, juice direction, book coordination, and public divergence. When these conflict, the grade goes down, not up. Mixed signals are PASS, not WATCH.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'U6',
    bucket: 'universal',
    title: 'Calibration over certainty',
    body: `A 55% long-run win rate is the edge of viability. Most markets are efficient most of the time. HSA finds the few that aren't. Never narrate as if the market is obviously wrong.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'U7',
    bucket: 'universal',
    title: 'Honesty about partial data',
    body: `If half a signal is observable and half isn't, say so. Never fabricate two-sided reads from one-sided data. Label the gap explicitly.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'U8',
    bucket: 'universal',
    title: 'Cents math must be continuous across ±100',
    body: `American odds are discontinuous at even money. Every juice calculation goes through the cent-line utility. Never raw subtraction. Hard invariant.`,
    last_validated: '2026-04-19',
    tags: ['juice', 'math'],
  },
  {
    id: 'U9',
    bucket: 'universal',
    title: 'Silence beats confident wrong',
    body: `When data is thin or signals conflict, INSUFFICIENT_DATA or NOISE is the right grade. An HSA that grades everything grades wrong on edge cases.`,
    last_validated: '2026-04-19',
  },
];
