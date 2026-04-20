/**
 * NCAAF sport principles.
 *
 * Structural invariant: this file imports ONLY from ../types. No imports
 * between principle files.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'NCAAF1',
    bucket: 'sport',
    title: 'Key numbers similar to NFL but less dominant',
    body: `3 and 7 still matter but less dominantly — college games score higher and more chaotically. 10 and 14 emerge as secondary keys.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'NCAAF2',
    bucket: 'sport',
    title: 'Talent gaps drive large spreads',
    body: `Mismatched matchups produce 35+ point spreads impossible in NFL. Closing line theory holds but with wider tolerance bands — a 2-point move on a -38 game is different from a 2-point move on a -3 game.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'NCAAF3',
    bucket: 'sport',
    title: 'Home environment is extreme at top programs',
    body: `Alabama, LSU, Penn State, Ohio State, Texas A&M (night game), Oregon — home-field worth 5-7 points, not 3. Public sometimes underweights road-dog value at these venues.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'NCAAF4',
    bucket: 'sport',
    title: 'Look-ahead and let-down spots',
    body: `Teams with marquee games the following week underperform; teams coming off marquee wins underperform. Public ignores schedule context; sharp action on look-ahead underdogs is a recurring edge.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'NCAAF5',
    bucket: 'sport',
    title: 'Weather and altitude matter more than NFL',
    body: `College stadiums span wider weather and altitude ranges than NFL. Wyoming, Air Force, BYU altitude, SEC heat, Big Ten November cold — larger total-moving effects than NFL equivalents.`,
    last_validated: '2026-04-20',
  },
  {
    id: 'NCAAF6',
    bucket: 'sport',
    title: 'Small conferences = sharpest edge',
    body: `Lower limits, less sharp scrubbing, more public bias baked into lines. Sharp signals on MAC, Sun Belt, C-USA are higher-conviction than SEC/Big Ten where books are tight.`,
    last_validated: '2026-04-20',
  },
];
