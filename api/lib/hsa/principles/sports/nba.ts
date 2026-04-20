/**
 * NBA sport principles.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Only the Principle type from ../types.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'NBA1',
    bucket: 'sport',
    title: '2H scores more than 1H',
    body: `Foul situations, free throw pace, and timeout usage compound in the second half. Books historically split game totals evenly; real scoring distribution runs ~48/52 to ~47/53 favoring the second half. Relevant for 2H totals specifically. Applies to: total, moneyline.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NBA2',
    bucket: 'sport',
    title: 'Rest disparity is a primary market driver',
    body: `Back-to-backs, 3-in-4s, and 4-in-6s are the most visible informational edges in the NBA. Sharp money hits rest mismatches early; public money follows star names regardless of fatigue. Rest asymmetry is a reliable RLM source across spread, ML, and total.`,
    last_validated: '2026-04-19',
    tags: ['rest', 'rlm'],
  },
  {
    id: 'NBA3',
    bucket: 'sport',
    title: 'Coaching tendency is priced-in',
    body: `The historical coach habit-mapping edge is now largely priced in. HSA should not narrate "coach X tends to..." as a fresh signal — it's a baseline books have already absorbed. Treat as context, not alpha.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NBA4',
    bucket: 'sport',
    title: 'Garbage time affects totals asymmetrically',
    body: `Blowouts suppress totals (starters benched, pace drops); competitive games run hot. Spread-implied blowout + flat total = potential under signal.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NBA5',
    bucket: 'sport',
    title: 'Lines move fast in a short window',
    body: `NBA lines post ~24 hours out and do most of their movement in the final 6-8 hours. Move velocity matters more than total magnitude. A 1-point move in the final hour carries more weight than a 1.5-point move over 18 hours.`,
    last_validated: '2026-04-19',
    tags: ['velocity'],
  },
  {
    id: 'NBA6',
    bucket: 'sport',
    title: 'Marquee-team shading is severe',
    body: `Lakers, Warriors, Celtics, Knicks (when relevant), and current championship favorites attract disproportionate public money. Their lines are shaded against them by 0.5-1 point relative to quieter teams. RLM signals on marquee teams in the unpopular direction are among the strongest in the league.`,
    last_validated: '2026-04-19',
    tags: ['public-bias', 'rlm'],
  },
];
