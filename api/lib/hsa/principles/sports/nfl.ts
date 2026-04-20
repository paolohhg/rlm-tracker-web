/**
 * NFL sport principles.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Only the Principle type from ../types.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'NFL1',
    bucket: 'sport',
    title: '3 and 7 are structural, not incremental',
    body: `~15% of NFL games land on a 3-point margin, ~9% on 7. Crossing these numbers is categorically different from moving within them. Half-point buys across 3 or 7 are often worth the extra juice. No other sport has key numbers this dominant.`,
    last_validated: '2026-04-19',
    tags: ['key-numbers'],
  },
  {
    id: 'NFL2',
    bucket: 'sport',
    title: 'NFL lines move over days, not hours',
    body: `Openers post Sunday/Monday; games are Sunday/Monday/Thursday. Sharp money bets openers early when books are most vulnerable; public money arrives Thursday-Sunday. Long movement window = more distinguishable sharp vs public phases.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NFL3',
    bucket: 'sport',
    title: 'Weather drives totals more than spreads',
    body: `Wind 15+ mph moves outdoor totals by 3-5 points, rain/snow adds another 1-3. Spreads barely move on weather unless it asymmetrically hurts one team's style. Weather-driven total moves are informational (U3), not sharp action.`,
    last_validated: '2026-04-19',
    tags: ['weather'],
  },
  {
    id: 'NFL4',
    bucket: 'sport',
    title: 'Injury news breaks in waves',
    body: `Wednesday practice reports, Friday official status, Sunday inactives — each wave triggers line movement. HSA must distinguish injury-news absorption from money-driven movement; the market move may be purely reactive.`,
    last_validated: '2026-04-19',
    tags: ['injuries'],
  },
  {
    id: 'NFL5',
    bucket: 'sport',
    title: 'Home-field is ~3 points, variable by venue',
    body: `Baseline HFA is ~2.5-3 points. Specific venues (Seattle, Kansas City, Green Bay in cold) run higher; dome teams on the road run lower. Standard HFA adjustments are priced in; venue-specific residuals sometimes aren't.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NFL6',
    bucket: 'sport',
    title: 'Divisional games compress spreads',
    body: `Familiarity and motivation tighten divisional matchups. Spreads run 1-2 points tighter than non-divisional equivalents.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NFL7',
    bucket: 'sport',
    title: 'Primetime games are heavily shaded',
    body: `MNF, TNF, SNF attract disproportionate public money. Lines shade against the more popular team. RLM signals on primetime unpopular sides are among the cleanest in the market.`,
    last_validated: '2026-04-19',
    tags: ['public-bias', 'rlm'],
  },
];
