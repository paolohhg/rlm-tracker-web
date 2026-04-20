/**
 * Spread market principles.
 *
 * Structural invariant: this file imports ONLY from ../types. No imports
 * between principle files.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'S1',
    bucket: 'market',
    title: 'Key numbers are more than numbers',
    body: `In NFL, 3 and 7 are the most common margins — crossing them is a structural move, not an incremental one. NBA keys cluster at 3/4/5/7/10 but are softer. NCAAB keys are softer still. NHL and MLB spreads are stuck at ±1.5 and have no key-number concept. Movement across a key matters more than equivalent movement within one.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'S2',
    bucket: 'market',
    title: 'Half-point value is asymmetric',
    body: `A move from -3 to -3.5 or -6.5 to -7 is worth more than the same numeric distance off-key. The half-point either buys you across a key or crosses one against you. HSA should note key crossings explicitly in the Read: line.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'S3',
    bucket: 'market',
    title: 'On stuck-line sports, juice is the signal',
    body: `MLB run line and NHL puck line are frozen at ±1.5. The line doesn't move. Signal lives entirely in the two juice sides moving against each other. A "frozen spread" read on these sports without juice data is not a frozen-market read — it's a blind read.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'S4',
    bucket: 'market',
    title: 'Spread RLM is higher-conviction than ML RLM',
    body: `Reverse line movement on a spread — line moves against the public ticket count — is the cleanest retail-observable sharp signal. Sportsbooks move spreads only when forced. If ticket % is heavy on one side and the spread moves the other way, sharp money is the cause.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'S5',
    bucket: 'market',
    title: 'Late spread moves carry more weight than early',
    body: `Early sharp money hits openers; the number being posted is partially the book's soft opinion. By the final hours before game time, the market has absorbed most information — a spread move in the last hour or two is acting on residual edge and deserves more signal weight than an opening-hours move of equivalent magnitude.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'S6',
    bucket: 'market',
    title: 'Book disagreement on spreads is rare and meaningful',
    body: `Unlike totals, spreads tend to converge across books within tight ranges. When books disagree by more than a half point on a non-key number, or across a key number, that disagreement is itself a signal — a book is either stale or deliberately off-market.`,
    last_validated: '2026-04-20',
  },
];
