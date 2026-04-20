/**
 * NCAAB sport principles.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Only the Principle type from ../types.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'NCAAB1',
    bucket: 'sport',
    title: 'Two 20-minute halves, not quarters',
    body: `Foul bonus timing, pace structure, and halftime window differ from NBA. Any logic inherited from NBA that assumes quarters is wrong here.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NCAAB2',
    bucket: 'sport',
    title: 'Home court is stronger than NBA',
    body: `College home-court advantage is ~3.5-4 points vs NBA's ~2-2.5. Crowd, rim familiarity, and travel disruption matter more at amateur level. Public underweights it on road favorites.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NCAAB3',
    bucket: 'sport',
    title: 'Schedule density is low, information is thin',
    body: `Most teams play 1-2 games per week. Less data per team per week means noisier power ratings and slower error correction by books. More exploitable inefficiencies than NBA — but also more false signals.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NCAAB4',
    bucket: 'sport',
    title: 'Small conference lines are the sharpest edge',
    body: `MAC, MAAC, Sun Belt, etc. — these games have lower limits and less sharp action scrubbing the line. Books shade heavily toward perceived public bias because square parlay money dominates. Sharp signals on these games are high-conviction when they appear.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NCAAB5',
    bucket: 'sport',
    title: 'Key numbers are softer than NBA',
    body: `3-point game and 2-point game matter some, but not structurally like NFL 3 and 7. Half-point buys are rarely worth the extra juice.`,
    last_validated: '2026-04-19',
    tags: ['key-numbers'],
  },
  {
    id: 'NCAAB6',
    bucket: 'sport',
    title: 'Heavy favorites at -22+ are near-automatic',
    body: `Historical ATS/ML win rate for 22-24.5 point favorites in NCAAB is ~98.9% on the ML. Laying heavy chalk under -5000 has historical edge. HSA should recognize this distribution for ML reads on large spreads.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NCAAB7',
    bucket: 'sport',
    title: 'Halftime window is longer than NBA',
    body: `NCAAB halftime is longer than NBA halftime — more time for books to adjust 2H lines and for sharp action to hit before the second half tips. Different signal rhythm than NBA 2H.`,
    last_validated: '2026-04-19',
  },
];
