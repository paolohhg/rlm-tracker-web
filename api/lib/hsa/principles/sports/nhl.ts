/**
 * NHL sport principles.
 *
 * STRUCTURAL INVARIANT: This file MUST NOT import from any other principle
 * file. Only the Principle type from ../types.
 */

import type { Principle } from '../types';

export const PRINCIPLES: Principle[] = [
  {
    id: 'NHL1',
    bucket: 'sport',
    title: 'Puck line is stuck at ±1.5',
    body: `Same structural principle as MLB run line. Spread is frozen; signal lives in juice. Puck line readings without juice data are blind reads.`,
    last_validated: '2026-04-19',
    tags: ['stuck-line', 'juice'],
  },
  {
    id: 'NHL2',
    bucket: 'sport',
    title: 'Moneyline is primary',
    body: `Sharp action and price discovery happen on ML first. Puck line juice confirms. HSA should treat ML as leading indicator on NHL games.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NHL3',
    bucket: 'sport',
    title: 'Goalie confirmation is the lineup event',
    body: `Goalie announcements happen ~1 hour before puck drop — sometimes later. Until confirmed, lines are provisional. Backup goalies shift totals 0.5-1.0 goals and sides materially. Pre-confirmation NHL lines should be treated as softer than post-confirmation across ML, puck line, and totals.`,
    last_validated: '2026-04-19',
    tags: ['goalie', 'lineup'],
  },
  {
    id: 'NHL4',
    bucket: 'sport',
    title: 'Back-to-back fatigue is more severe than NBA',
    body: `No travel day, full-contact sport. Teams on the second night of a back-to-back underperform expectations. Public underweights this; sharps don't.`,
    last_validated: '2026-04-19',
    tags: ['rest'],
  },
  {
    id: 'NHL5',
    bucket: 'sport',
    title: 'Empty-net goals distort totals and sides late',
    body: `Late-game empty-net scoring adds ~0.3 goals per game on average, concentrated on the ~25% of games that are one-goal with ~2 minutes left. Over totals and the leading side get residual value from ENGs that the public treats as random.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NHL6',
    bucket: 'sport',
    title: 'Special teams are volatile and drive totals',
    body: `Power-play percentages and penalty-kill percentages swing game totals more than in other sports. Matchup between a top PP unit and a weak PK is a total-mover books sometimes miss.`,
    last_validated: '2026-04-19',
  },
  {
    id: 'NHL7',
    bucket: 'sport',
    title: 'Public ML patterns skew to favorites at -150 and below',
    body: `Moderate favorites attract heavy public action. -120 to -150 NHL favorites are structurally shaded; dog ML value often sits at +110 to +130 when sharp money is on the dog despite flat ticket counts.`,
    last_validated: '2026-04-19',
    tags: ['public-bias'],
  },
];
