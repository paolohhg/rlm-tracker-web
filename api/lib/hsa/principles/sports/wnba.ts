/**
 * WNBA sport principles.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Only the Principle type from ../types.
 *
 * NOTE: WNBA file is minimum viable. Tagged 'preliminary' — expect
 * population as coverage matures.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'WNBA1',
    bucket: 'sport',
    title: 'Market depth is thinner than NBA',
    body: `Fewer sharp accounts, lower limits, slower line correction. Sharp signals that appear tend to be more actionable but smaller in raw cent magnitude.`,
    last_validated: '2026-04-19',
    tags: ['preliminary'],
  },
  {
    id: 'WNBA2',
    bucket: 'sport',
    title: '40-minute games, 10-minute quarters',
    body: `Different pace structure than NBA. Total scoring is lower; key numbers for totals are different.`,
    last_validated: '2026-04-19',
    tags: ['preliminary'],
  },
  {
    id: 'WNBA3',
    bucket: 'sport',
    title: 'Travel and rest are high-impact',
    body: `Smaller league, B2B scheduling still common. Rest asymmetry matters more than NBA.`,
    last_validated: '2026-04-19',
    tags: ['preliminary', 'rest'],
  },
];
