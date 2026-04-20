/**
 * HSA Principles — public entry point.
 *
 * Re-exports each principle array under a bucket-qualified alias and exposes
 * getPrinciplesFor(market, league) which composes universal + market + sport
 * principles for a slot prompt.
 *
 * Structural invariant: principle files never import from each other. This
 * index is the sole aggregation point. Slot prompts (downstream) should
 * import from here, not from individual principle files.
 */

export type { Principle, PrincipleBucket } from './types';

export { PRINCIPLES as UNIVERSAL } from './universal';
export { PRINCIPLES as SPREAD_MARKET } from './markets/spread';
export { PRINCIPLES as TOTAL_MARKET } from './markets/total';
export { PRINCIPLES as MONEYLINE_MARKET } from './markets/moneyline';
export { PRINCIPLES as NBA } from './sports/nba';
export { PRINCIPLES as NCAAB } from './sports/ncaab';
export { PRINCIPLES as NFL } from './sports/nfl';
export { PRINCIPLES as NCAAF } from './sports/ncaaf';
export { PRINCIPLES as MLB } from './sports/mlb';
export { PRINCIPLES as NHL } from './sports/nhl';
export { PRINCIPLES as WNBA } from './sports/wnba';

import type { Principle } from './types';
import { PRINCIPLES as UNIVERSAL_P } from './universal';
import { PRINCIPLES as SPREAD_P } from './markets/spread';
import { PRINCIPLES as TOTAL_P } from './markets/total';
import { PRINCIPLES as MONEYLINE_P } from './markets/moneyline';
import { PRINCIPLES as NBA_P } from './sports/nba';
import { PRINCIPLES as NCAAB_P } from './sports/ncaab';
import { PRINCIPLES as NFL_P } from './sports/nfl';
import { PRINCIPLES as NCAAF_P } from './sports/ncaaf';
import { PRINCIPLES as MLB_P } from './sports/mlb';
import { PRINCIPLES as NHL_P } from './sports/nhl';
import { PRINCIPLES as WNBA_P } from './sports/wnba';

export type League = 'NBA' | 'NCAAB' | 'NFL' | 'NCAAF' | 'MLB' | 'NHL' | 'WNBA';
export type Market = 'spread' | 'total' | 'moneyline';

const MARKET_MAP: Record<Market, Principle[]> = {
  spread: SPREAD_P,
  total: TOTAL_P,
  moneyline: MONEYLINE_P,
};

const LEAGUE_MAP: Record<League, Principle[]> = {
  NBA: NBA_P,
  NCAAB: NCAAB_P,
  NFL: NFL_P,
  NCAAF: NCAAF_P,
  MLB: MLB_P,
  NHL: NHL_P,
  WNBA: WNBA_P,
};

export function getPrinciplesFor(market: Market, league: League): Principle[] {
  return [...UNIVERSAL_P, ...MARKET_MAP[market], ...LEAGUE_MAP[league]];
}
