export type GameStatus = 'upcoming' | 'live' | 'final'
export type League = 'NBA' | 'NCAAB' | 'NHL' | 'MLB'
export type Tournament = 'ncaa_tournament' | 'nit' | null
export type HsaStatus = 'no_narrative' | 'narrative' | 'pending'
export type SignalTier = 'DOUBLE NO-NARRATIVE RLM' | 'NO-NARRATIVE RLM' | 'STEAM MOVE' | 'BOOK SHADE' | 'SHARP ACCUMULATION' | 'FROZEN LINE' | 'CONTRA MOVE' | 'WATCH' | 'TRACKING' | null

export interface GameView {
  id: string
  league: League
  tournament: Tournament
  awayTeam: string
  homeTeam: string
  gameTime: string
  status: GameStatus
  timeToTipMinutes: number
  signalTier: SignalTier
  sharpTeam: string | null
  fadeTeam: string | null
  homeScore: number | null
  awayScore: number | null
  period: number | null
  gameClock: string | null
  openingSpread: number | null
  currentSpread: number | null
  closingSpread: number | null
  lineMoveAmount: number | null
  booksAgreeing: number | null
  totalBooks: number | null
  velocityPerHour: number | null
  publicBetsPct: number | null
  publicMoneyPct: number | null
  awayBetsPct: number | null
  awayMoneyPct: number | null
  sharpMoneyPct: number | null
  numBets: number | null
  scenarioKey: string | null
  hsaStatus: HsaStatus
  hsaSnippet: string | null
  hsaNarrative: string | null
  hsaBetTeam: string | null
  hsaBetSpread: string | null
  hsaSignalAction: string | null
  openingTotal: number | null
  currentTotal: number | null
  totalMove: number | null
  highestTotalSeen: number | null
  lowestTotalSeen: number | null

  // Totals splits
  overTicketPct: number | null
  underTicketPct: number | null
  overMoneyPct: number | null
  underMoneyPct: number | null

  // Totals signal
  totalSignalType: string | null
  totalVelocityPerHour: number | null

  // Intelligence — Line Resistance
  isResistance: boolean
  resistanceScore: number
  resistanceReason: string | null

  // Intelligence — Fake Steam
  isFakeSteam: boolean
  fakeSteamScore: number
  fakeSteamReason: string | null
  followerCount: number | null
  confirmationRate: number | null
  marketRange: number | null
  medianLine: number | null
  outlierBookCount: number | null

  // Moneyline
  openingMoneylineHome: number | null
  openingMoneylineAway: number | null
  moneylineHome: number | null
  moneylineAway: number | null
  mlMoveHome: number | null

  // Book coverage (for partial board display)
  booksReporting: number | null

  isLocked: boolean
  lastUpdated: string
}

export interface FilterState {
  search: string
  league: 'all' | 'NBA' | 'NCAAB' | 'NHL' | 'MLB'
  signal: 'all' | 'strong' | 'rlm' | 'steam' | 'frozen' | 'no_narrative' | 'tracking'
  timeBucket: 'all' | 'lt30' | '30to60' | '1to3h' | 'gt3h' | 'live' | 'final'
  actionableOnly: boolean
  sort: 'signal' | 'soonest' | 'updated'
}
