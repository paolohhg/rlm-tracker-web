/**
 * Moneyline market principles.
 *
 * Structural invariant: this file imports ONLY from ../types. No imports
 * between principle files.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'ML1',
    bucket: 'market',
    title: 'Moneyline is pure juice — no line to move',
    body: `There is no "point" on a moneyline. The entire market is the price. Every ML signal is a juice signal. ML steam is always a cent move; ML RLM is always a juice direction vs. ticket direction mismatch. Treat ML as a specialized juice-reading problem, not as "like spread but simpler."`,
    last_validated: '2026-04-20',
  },
  {
    id: 'ML2',
    bucket: 'market',
    title: 'Implied probability, not cent deltas, for cross-game comparison',
    body: `A 10-cent move on a -180 favorite and a 10-cent move on a +150 dog are NOT equivalent in market impact. Raw cent math is fine within one game's market. Comparing magnitude across games requires implied probability. HSA should internally compute prob-deltas and narrate in cents, not the other way around.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'ML3',
    bucket: 'market',
    title: 'Longshot bias is real',
    body: `Public bettors overvalue big underdogs. Books shade longshots to lengthen the odds further, capturing this bias. An ML that moves TOWARD the longshot (dog price shortens) despite the public chasing the payoff is a strong sharp signal — it's fighting both pro longshot correction and public momentum in the same direction.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'ML4',
    bucket: 'market',
    title: 'Heavy chalk ML is skill-dependent',
    body: `Laying -300 or worse isn't inherently bad — historical data supports heavy chalk in specific distributions (e.g., NCAAB 22+ point favorites cash at ~99%). But HSA should not narrate heavy chalk as "sharp side" without explicit juice-movement confirmation. Chalk action is often square parlay-building, not sharp conviction.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'ML5',
    bucket: 'market',
    title: 'ML and spread disagreement is information',
    body: `If spread juice moves one direction but ML juice moves the other, something is wrong with one of the reads. Typically it's a stale book on the less-liquid market. HSA should flag rather than synthesize.`,
    last_validated: '2026-04-20',
  },
];
