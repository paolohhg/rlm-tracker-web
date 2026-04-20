/**
 * Principles foundation barrel + selector.
 *
 * STRUCTURAL INVARIANT: This is the ONLY file allowed to import from
 * multiple principle files. Principle files do not import from each other.
 * Slot prompts (future work) call getPrinciplesFor() rather than reaching
 * directly into individual files.
 */

import type { Principle } from './types';
import { PRINCIPLES as UNIVERSAL_P } from './universal';
import { PRINCIPLES as SPREAD_MARKET_P } from './markets/spread';
import { PRINCIPLES as TOTAL_MARKET_P } from './markets/total';
import { PRINCIPLES as MONEYLINE_MARKET_P } from './markets/moneyline';
import { PRINCIPLES as NBA_P } from './sports/nba';
import { PRINCIPLES as NCAAB_P } from './sports/ncaab';
import { PRINCIPLES as NFL_P } from './sports/nfl';
import { PRINCIPLES as NCAAF_P } from './sports/ncaaf';
import { PRINCIPLES as MLB_P } from './sports/mlb';
import { PRINCIPLES as NHL_P } from './sports/nhl';
import { PRINCIPLES as WNBA_P } from './sports/wnba';

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

export type League = 'NBA' | 'NCAAB' | 'NFL' | 'NCAAF' | 'MLB' | 'NHL' | 'WNBA';
export type Market = 'spread' | 'total' | 'moneyline';

export function getPrinciplesFor(market: Market, league: League): Principle[] {
  const universal = UNIVERSAL_P;

  const marketPrinciples = {
    spread: SPREAD_MARKET_P,
    total: TOTAL_MARKET_P,
    moneyline: MONEYLINE_MARKET_P,
  }[market];

  const sportPrinciples = {
    NBA: NBA_P,
    NCAAB: NCAAB_P,
    NFL: NFL_P,
    NCAAF: NCAAF_P,
    MLB: MLB_P,
    NHL: NHL_P,
    WNBA: WNBA_P,
  }[league];

  return [...universal, ...marketPrinciples, ...sportPrinciples];
}
