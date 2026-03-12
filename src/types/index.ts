export type GameStatus = 'upcoming' | 'live' | 'final'
export type League = 'NBA' | 'NCAAB'
export type HsaStatus = 'no_narrative' | 'narrative' | 'pending'
export type SignalTier = 'DOUBLE NO-NARRATIVE RLM' | 'NO-NARRATIVE RLM' | 'STEAM MOVE' | 'BOOK SHADE' | 'FROZEN LINE' | 'CONTRA MOVE' | 'WATCH' | 'TRACKING' | null

export interface GameView {
  id: string
  league: League
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
  scenarioKey: string | null
  hsaStatus: HsaStatus
  hsaSnippet: string | null
  isLocked: boolean
  lastUpdated: string
}

export interface FilterState {
  search: string
  league: 'all' | 'NBA' | 'NCAAB'
  signal: 'all' | 'strong' | 'rlm' | 'steam' | 'frozen' | 'no_narrative' | 'tracking'
  timeBucket: 'all' | 'lt30' | '30to60' | '1to3h' | 'gt3h' | 'live' | 'final'
  actionableOnly: boolean
  sort: 'signal' | 'soonest' | 'updated'
}
